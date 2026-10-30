/* VoiceLab 前端逻辑：聊天（可切多家大模型）、录音（浏览器直接产 16k WAV）、音色管理 */
"use strict";

const $ = (sel) => document.querySelector(sel);
const messagesEl = $("#messages");
const inputEl = $("#input");
const sendBtn = $("#send-btn");
const micBtn = $("#mic-btn");
const voiceSelect = $("#voice-select");
const llmSelect = $("#llm-select");

const MAX_RECORD_MS = 28000; // 上游识别接口限 30 秒，留点余量

let busy = false;
let recording = false;
let selectedVoice = "";
let selectedLlm = localStorage.getItem("voicelab_llm") || "";
let customVoices = loadCustomVoices(); // 本机保存的克隆音色 {provider, id, name}
let healthInfo = null;

/* 克隆参考音频的两个来源（二选一） */
let refFile = null;      // <input type=file>
let refBlob = null;      // 现场录音

/* ---------------- 基础工具 ---------------- */

function showToast(text, isErr = false, ms = 3500) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("err", isErr);
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON（理论上不会） */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败（HTTP ${res.status}）`);
  }
  return data;
}

function loadCustomVoices() {
  try { return JSON.parse(localStorage.getItem("voicelab_voices") || "[]"); }
  catch { return []; }
}

/* ---------------- 音色调音台（Web Audio 实时处理播放流） ---------------- */

const timbre = loadTimbre();      // 旋钮值 0~100，双极旋钮 50 为中性
let audioCtxFX = null, fx = null, fxBypass = false;

function loadTimbre() {
  const def = { bright: 50, warm: 50, thick: 50, harm: 0 };
  try { return { ...def, ...JSON.parse(localStorage.getItem("voicelab_timbre") || "{}") }; }
  catch { return { ...def }; }
}
function saveTimbre() {
  localStorage.setItem("voicelab_timbre", JSON.stringify(timbre));
}

function satCurve(k) { // 软削波产生谐波泛音：k 越大泛音越足
  const n = 2048, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

function ensureFX() {
  if (audioCtxFX) return;
  audioCtxFX = new (window.AudioContext || window.webkitAudioContext)();
  const input = audioCtxFX.createGain();
  const shaper = audioCtxFX.createWaveShaper(); // 泛音：谐波激励
  shaper.oversample = "4x";
  const p170 = audioCtxFX.createBiquadFilter(); // 厚度：低频体感
  p170.type = "peaking"; p170.frequency.value = 170; p170.Q.value = 0.9;
  const p320 = audioCtxFX.createBiquadFilter(); // 冷暖：低中频冷暖偏移
  p320.type = "peaking"; p320.frequency.value = 320; p320.Q.value = 0.8;
  const shelf = audioCtxFX.createBiquadFilter(); // 明暗：高频倾斜
  shelf.type = "highshelf"; shelf.frequency.value = 5000;
  const comp = audioCtxFX.createDynamicsCompressor(); // 厚度附带的"胶水感"
  comp.attack.value = 0.01; comp.release.value = 0.15;
  comp.ratio.value = 2.5; comp.knee.value = 12;
  const out = audioCtxFX.createGain();
  input.connect(shaper); shaper.connect(p170); p170.connect(p320);
  p320.connect(shelf); shelf.connect(comp); comp.connect(out);
  out.connect(audioCtxFX.destination);
  fx = { input, shaper, p170, p320, shelf, comp, out };
  applyTimbre();
}

function applyTimbre() {
  if (!fx) return;
  const b = (timbre.bright - 50) / 50, w = (timbre.warm - 50) / 50;
  const th = (timbre.thick - 50) / 50, h = timbre.harm / 100;
  fx.shelf.gain.value = b * 10;                 // 明暗 ±10dB @5kHz
  fx.p320.gain.value = w * 8;                   // 冷暖 ±8dB @320Hz
  fx.p170.gain.value = th * 9;                  // 厚度 ±9dB @170Hz
  fx.comp.threshold.value = -14 - th * 8;       // 越厚压得越紧
  fx.out.gain.value = 1 + Math.max(0, th) * 0.25;
  fx.shaper.curve = h < 0.01 ? null : satCurve(1 + h * 9);
}

async function playB64(b64, mime) { // 聊天回复和试听都从这里出声
  ensureFX();
  if (audioCtxFX.state === "suspended") await audioCtxFX.resume();
  const el = new Audio(`data:${mime};base64,${b64}`);
  const src = audioCtxFX.createMediaElementSource(el);
  src.connect(fxBypass ? audioCtxFX.destination : fx.input);
  el.addEventListener("ended", () => { try { src.disconnect(); } catch {} });
  await el.play();
}

/* ---------------- 消息气泡 ---------------- */

function addMsg(role, text, pending = false) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}${pending ? " pending" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { wrap, bubble };
}

async function askAndReply(text) {
  addMsg("user", text);
  const pending = addMsg("assistant", "思考中…", true);
  try {
    const data = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: selectedVoice, llm: selectedLlm }),
    });
    pending.bubble.textContent = data.reply_text;
    pending.wrap.classList.remove("pending");
    if (data.llm) {
      const tag = document.createElement("div");
      tag.className = "model-tag";
      tag.textContent = "🗣 " + data.llm;
      pending.wrap.appendChild(tag);
    }
    try { await playB64(data.audio_b64, data.audio_mime); }
    catch { showToast("音频自动播放被浏览器拦截，点一下页面再试", true); }
  } catch (err) {
    pending.bubble.textContent = "出错了：" + err.message;
  }
}

/* ---------------- 发送文字 ---------------- */

async function sendText() {
  if (busy || recording) return;
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  busy = true; sendBtn.disabled = true;
  await askAndReply(text);
  busy = false; sendBtn.disabled = false;
}

/* ---------------- 录音：浏览器直接编码 16k 单声道 WAV ---------------- */

let audioCtx = null, mediaStream = null, processor = null, sourceNode = null;
let chunks = [], recTimer = null, recTick = null, recStartAt = 0;

async function startRecord(onDone) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showToast("拿不到麦克风权限：请允许浏览器使用麦克风（需 localhost 或 https）", true);
    return false;
  }
  audioCtx = new AudioContext();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  chunks = [];
  processor.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  sourceNode.connect(processor);
  processor.connect(audioCtx.destination);
  recStartAt = Date.now();
  recTick = setInterval(() => {
    $("#rec-time").textContent = Math.floor((Date.now() - recStartAt) / 1000) + "s";
  }, 500);
  recTimer = setTimeout(() => stopRecord(onDone), MAX_RECORD_MS); // 到点自动停
  return true;
}

async function stopRecord(onDone) {
  if (!recording) return;
  recording = false;
  clearTimeout(recTimer); clearInterval(recTick);
  if (processor) processor.disconnect();
  if (sourceNode) sourceNode.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  const sampleRate = audioCtx.sampleRate;
  await audioCtx.close();
  audioCtx = null;

  micBtn.classList.remove("recording");
  $("#rec-ref-btn").classList.remove("recording");
  $("#rec-ref-btn").textContent = "🎤 录一段";
  $("#rec-hint").classList.add("hidden");

  const merged = mergeChunks(chunks);
  const wav = encodeWAV(downsample(merged, sampleRate, 16000), 16000);
  if (onDone) onDone(new Blob([wav], { type: "audio/wav" }));
}

function mergeChunks(list) {
  const total = list.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of list) { out.set(c, off); off += c.length; }
  return out;
}

function downsample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] || 0, b = samples[idx + 1] || a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function encodeWAV(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVEfmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/* ---------------- 麦克风聊天 / 录克隆参考音 ---------------- */

micBtn.addEventListener("click", async () => {
  if (busy) return;
  if (recording) { await stopRecord(chatOnRecord); return; }
  if (!(await startRecord(chatOnRecord))) return;
  recording = true;
  micBtn.classList.add("recording");
  $("#rec-hint").classList.remove("hidden");
});

async function chatOnRecord(blob) {
  busy = true; sendBtn.disabled = true; micBtn.disabled = true;
  const pending = addMsg("assistant", "识别中…", true);
  try {
    const fd = new FormData();
    fd.append("file", blob, "record.wav");
    const { text } = await api("/api/asr", { method: "POST", body: fd });
    pending.wrap.remove();
    if (!text.trim()) { showToast("没听清你说的话，再试一次？", true); return; }
    await askAndReply(text);
  } catch (err) {
    pending.wrap.remove();
    showToast(err.message, true);
  } finally {
    busy = false; sendBtn.disabled = false; micBtn.disabled = false;
  }
}

/* ---------------- 对话模型列表 ---------------- */

async function refreshLlms() {
  try {
    const data = await api("/api/llms");
    llmSelect.innerHTML = "";
    for (const item of data.llms) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.ready
        ? `${item.label}（${item.model}）`
        : `${item.label} 🔒`;
      opt.disabled = !item.ready;
      llmSelect.appendChild(opt);
    }
    // 恢复上次选择；失效则用后端默认
    const readyIds = data.llms.filter((x) => x.ready).map((x) => x.id);
    if (!readyIds.includes(selectedLlm)) selectedLlm = data.default || "";
    if (selectedLlm) {
      llmSelect.value = selectedLlm;
    } else {
      // 一家 key 都没配时给个占位说明
      const placeholder = document.createElement("option");
      placeholder.textContent = "先在 .env 配置任意一家的 KEY";
      placeholder.disabled = true;
      placeholder.selected = true;
      llmSelect.appendChild(placeholder);
    }
  } catch (err) {
    llmSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.textContent = "模型列表加载失败";
    opt.disabled = true;
    llmSelect.appendChild(opt);
  }
}

llmSelect.addEventListener("change", () => {
  selectedLlm = llmSelect.value;
  localStorage.setItem("voicelab_llm", selectedLlm);
});

/* ---------------- 音色列表 ---------------- */

let currentLib = []; // 服务端音色库（当前引擎的条目）

function renderVoices(serverVoices, lib) {
  currentLib = lib || [];
  const builtin = serverVoices.filter((v) => v.builtin !== false);
  const cloudCustom = serverVoices.filter((v) => v.builtin === false);
  const libIds = new Set(currentLib.map((v) => v.id));

  voiceSelect.innerHTML = "";
  const add = (label, list) => {
    if (!list.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const v of list) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      group.appendChild(opt);
    }
    voiceSelect.appendChild(group);
  };
  add("内置音色", builtin);
  add("音色库（聊天平台可用）", currentLib);
  add("云端克隆音色（未入库）", cloudCustom.filter((v) => !libIds.has(v.id)));

  if (selectedVoice && [...voiceSelect.options].some((o) => o.value === selectedVoice)) {
    voiceSelect.value = selectedVoice;
  } else {
    selectedVoice = voiceSelect.value || (serverVoices[0] && serverVoices[0].id) || "";
  }
}

async function migrateLocalVoices(lib) {
  // 老版本把克隆音色记在浏览器 localStorage；首次打开时迁移进服务端音色库
  if (localStorage.getItem("voicelab_migrated")) return;
  const known = new Set(lib.map((v) => v.provider + "|" + v.id));
  for (const v of customVoices) {
    if (known.has(v.provider + "|" + v.id)) continue;
    try {
      await api("/api/library/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: v.provider, id: v.id, name: v.name, note: "从浏览器本地迁移",
        }),
      });
    } catch { /* 迁移失败不阻塞界面 */ }
  }
  localStorage.setItem("voicelab_migrated", "1");
}

async function refreshVoices() {
  try {
    const provider = healthInfo ? healthInfo.provider : "";
    const [serverVoices, lib] = await Promise.all([
      api("/api/voices"),
      api("/api/library/voices?provider=" + encodeURIComponent(provider)),
    ]);
    await migrateLocalVoices(lib);
    renderVoices(serverVoices, lib);
  } catch (err) {
    renderVoices([], []);
    showToast(err.message, true);
  }
}

voiceSelect.addEventListener("change", () => { selectedVoice = voiceSelect.value; });

$("#try-voice").addEventListener("click", async () => {
  if (!selectedVoice) return showToast("先选一个音色", true);
  try {
    const data = await api("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "你好，我是你选择的音色，来听听看吧。", voice: selectedVoice }),
    });
    playB64(data.audio_b64, data.audio_mime);
  } catch (err) { showToast(err.message, true); }
});

$("#refresh-voices").addEventListener("click", refreshVoices);

$("#del-voice").addEventListener("click", async () => {
  const v = currentLib.find((x) => x.id === selectedVoice);
  if (!v) return showToast("选中的不是音色库条目，删不了", true);
  if (!confirm(`从音色库删除「${v.name}」？只删记录，云端音色本体不受影响。`)) return;
  try {
    await api(
      `/api/library/voices?provider=${encodeURIComponent(v.provider)}&id=${encodeURIComponent(v.id)}`,
      { method: "DELETE" }
    );
    selectedVoice = "";
    await refreshVoices();
    showToast("已从音色库删除");
  } catch (err) { showToast(err.message, true); }
});

/* ---------------- 克隆音色 ---------------- */

$("#rec-ref-btn").addEventListener("click", async () => {
  const btn = $("#rec-ref-btn");
  if (recording) { await stopRecord(onRefRecorded); return; }
  if (!(await startRecord(onRefRecorded))) return;
  recording = true;
  btn.textContent = "⏹ 停止";
  btn.classList.add("recording");
  $("#rec-hint").classList.remove("hidden");
});

async function onRefRecorded(blob) {
  refBlob = blob;
  refFile = null;
  $("#clone-file").value = "";
  const state = $("#ref-state");
  state.textContent = `已录音 ${Math.round(blob.size / 32000)} 秒`;
  state.classList.add("ready");
}

$("#clone-file").addEventListener("change", (e) => {
  refFile = e.target.files[0] || null;
  refBlob = null;
  const state = $("#ref-state");
  if (refFile) {
    state.textContent = refFile.name;
    state.classList.add("ready");
  } else {
    state.textContent = "未选择";
    state.classList.remove("ready");
  }
});

$("#clone-submit").addEventListener("click", async () => {
  if (busy || recording) return;
  const name = $("#clone-name").value.trim();
  const refText = $("#clone-text").value.trim();
  const audio = refBlob || refFile;
  if (!name) return showToast("先给音色起个名字", true);
  if (!audio) return showToast("先录音或选择一个参考音频（wav/mp3）", true);

  busy = true;
  const btn = $("#clone-submit");
  btn.disabled = true; btn.textContent = "克隆中…（约十几秒）";
  try {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("ref_text", refText);
    fd.append("file", audio, refBlob ? "reference.wav" : refFile.name);
    const voice = await api("/api/voices", { method: "POST", body: fd });
    await api("/api/library/voices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: healthInfo.provider,
        id: voice.id,
        name: voice.name,
        note: "克隆于 " + new Date().toLocaleDateString(),
      }),
    });
    selectedVoice = voice.id;
    await refreshVoices();
    showToast(`克隆成功！已切换到「${voice.name}」，试试试听吧`);
  } catch (err) {
    showToast(err.message, true, 6000);
  } finally {
    busy = false;
    btn.disabled = false; btn.textContent = "开始克隆";
  }
});

/* ---------------- 调音台 UI：旋钮 / 预设 / 原声对比 ---------------- */

const KNOB_DEFS = [
  { id: "bright", label: "明暗" },  // 双极：50 为中位
  { id: "warm", label: "冷暖" },
  { id: "thick", label: "厚度" },
  { id: "harm", label: "泛音", bipolar: false },
];

const TIMBRE_PRESETS = {
  warm:  { bright: 32, warm: 82, thick: 78, harm: 35 },
  bright: { bright: 78, warm: 32, thick: 40, harm: 25 },
  flat:  { bright: 50, warm: 50, thick: 50, harm: 0 },
};

function buildKnobs() {
  const grid = $("#knob-grid");
  grid.innerHTML = "";
  for (const def of KNOB_DEFS) {
    const wrap = document.createElement("div");
    wrap.className = "knob-wrap";
    const knob = document.createElement("div");
    knob.className = "knob";
    knob.tabIndex = 0;
    knob.setAttribute("role", "slider");
    knob.setAttribute("aria-label", def.label);
    const ind = document.createElement("div");
    ind.className = "knob-ind";
    knob.appendChild(ind);
    const name = document.createElement("div");
    name.className = "knob-label";
    name.textContent = def.label;
    const val = document.createElement("div");
    val.className = "knob-val";
    wrap.append(knob, name, val);
    grid.appendChild(wrap);

    const bipolar = def.bipolar !== false;
    const render = () => {
      const t = timbre[def.id] / 100;
      ind.style.setProperty("--angle", (-135 + t * 270) + "deg");
      val.textContent = bipolar ? timbre[def.id] - 50 : timbre[def.id];
    };
    let startY = 0, startVal = 0;
    knob.addEventListener("pointerdown", (e) => {
      startY = e.clientY;
      startVal = timbre[def.id];
      knob.setPointerCapture(e.pointerId);
    });
    knob.addEventListener("pointermove", (e) => {
      if (!knob.hasPointerCapture(e.pointerId)) return;
      const v = startVal + (startY - e.clientY) / 1.2; // 上拖增大
      timbre[def.id] = Math.max(0, Math.min(100, Math.round(v)));
      render(); applyTimbre(); saveTimbre();
    });
    knob.addEventListener("dblclick", () => {
      timbre[def.id] = bipolar ? 50 : 0;
      render(); applyTimbre(); saveTimbre();
    });
    render();
  }
}

document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    Object.assign(timbre, TIMBRE_PRESETS[btn.dataset.preset]);
    saveTimbre();
    buildKnobs(); applyTimbre();
    showToast(btn.dataset.preset === "flat" ? "已还原默认音色" : "已应用预设，播放试听感受一下");
  });
});

$("#fx-bypass").addEventListener("click", (e) => {
  fxBypass = !fxBypass;
  e.currentTarget.classList.toggle("active", fxBypass);
  showToast(fxBypass ? "直通原声（调音台已旁路）" : "调音台处理中");
});

buildKnobs();

/* ---------------- 初始化 ---------------- */

(async function init() {
  // PWA：注册 Service Worker（浏览器"安装应用"用；扩展环境没有 navigator.serviceWorker 也不报错）
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  sendBtn.addEventListener("click", sendText);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); }
  });

  try {
    healthInfo = await api("/api/health");
    $("#provider-badge").textContent = `语音引擎：${healthInfo.label}`;
    $("#key-status").classList.toggle("ok", healthInfo.key_ready);
    $("#key-status").title = healthInfo.key_ready ? "API Key 已配置" : "还没配置 API Key，请看 .env";
    if (!healthInfo.key_ready) {
      showToast("还没配置 API Key：复制 .env.example 为 .env 填入后重启服务", true, 8000);
    }
    if (!(healthInfo.capabilities || []).includes("clone")) {
      $("#clone-box").innerHTML = "<p class='tip'>当前引擎不支持克隆。</p>";
    }
  } catch {
    $("#provider-badge").textContent = "后端未连接";
  }
  refreshLlms();
  refreshVoices();
})();
