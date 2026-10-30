/* VoiceLab 工作台（扩展版）：与网页版同构，但数据层直接调云 API，无本地后端 */
"use strict";

import { VOICE_ENGINES, LLM_PRESETS, llmChat, llmReadyIds, blobToB64 } from "./shared/providers.js";

const $ = (sel) => document.querySelector(sel);
const messagesEl = $("#messages");
const inputEl = $("#input");
const sendBtn = $("#send-btn");
const micBtn = $("#mic-btn");
const voiceSelect = $("#voice-select");
const llmSelect = $("#llm-select");

const MAX_RECORD_MS = 28000; // 上游识别接口限 30 秒，留点余量
const SYSTEM_PROMPT = "你是 VoiceLab 语音助手。回答要口语化、简洁友好，一般不超过三句话，适合直接朗读出来。";

let settings = {};
let engine = null;
let busy = false;
let recording = false;
let selectedVoice = "";
let selectedLlm = localStorage.getItem("voicelab_llm") || "";
let customVoices = loadCustomVoices();

let refFile = null;
let refBlob = null;

/* ---------------- 基础工具 ---------------- */

function showToast(text, isErr = false, ms = 3500) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("err", isErr);
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), ms);
}

function loadCustomVoices() {
  try { return JSON.parse(localStorage.getItem("voicelab_voices") || "[]"); }
  catch { return []; }
}
function saveCustomVoices() {
  localStorage.setItem("voicelab_voices", JSON.stringify(customVoices));
}

/* ---------------- 音色调音台（与网页版完全一致） ---------------- */

const timbre = loadTimbre();
let audioCtxFX = null, fx = null, fxBypass = false;

function loadTimbre() {
  const def = { bright: 50, warm: 50, thick: 50, harm: 0 };
  try { return { ...def, ...JSON.parse(localStorage.getItem("voicelab_timbre") || "{}") }; }
  catch { return { ...def }; }
}
function saveTimbre() {
  localStorage.setItem("voicelab_timbre", JSON.stringify(timbre));
}

function satCurve(k) {
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
  const shaper = audioCtxFX.createWaveShaper();
  shaper.oversample = "4x";
  const p170 = audioCtxFX.createBiquadFilter();
  p170.type = "peaking"; p170.frequency.value = 170; p170.Q.value = 0.9;
  const p320 = audioCtxFX.createBiquadFilter();
  p320.type = "peaking"; p320.frequency.value = 320; p320.Q.value = 0.8;
  const shelf = audioCtxFX.createBiquadFilter();
  shelf.type = "highshelf"; shelf.frequency.value = 5000;
  const comp = audioCtxFX.createDynamicsCompressor();
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
  fx.shelf.gain.value = b * 10;
  fx.p320.gain.value = w * 8;
  fx.p170.gain.value = th * 9;
  fx.comp.threshold.value = -14 - th * 8;
  fx.out.gain.value = 1 + Math.max(0, th) * 0.25;
  fx.shaper.curve = h < 0.01 ? null : satCurve(1 + h * 9);
}

async function playB64(b64, mime) {
  ensureFX();
  if (audioCtxFX.state === "suspended") await audioCtxFX.resume();
  const el = new Audio(`data:${mime};base64,${b64}`);
  const src = audioCtxFX.createMediaElementSource(el);
  src.connect(fxBypass ? audioCtxFX.destination : fx.input);
  el.addEventListener("ended", () => { try { src.disconnect(); } catch {} });
  await el.play();
}

/* ---------------- 消息与发送 ---------------- */

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
    const key = settings[engine.keyField] || "";
    if (!key.trim()) throw new Error(`还没配置「${engine.label}」的 Key，点右上角 ⚙️ 设置`);
    const llmId = selectedLlm || llmReadyIds(settings)[0] || "";
    const { text: reply, label } = await llmChat(settings, llmId, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text.slice(0, 2000) },
    ]);
    pending.bubble.textContent = reply;
    pending.wrap.classList.remove("pending");
    const tag = document.createElement("div");
    tag.className = "model-tag";
    tag.textContent = "🗣 " + label;
    pending.wrap.appendChild(tag);

    const { blob, mime } = await engine.tts(key, {
      text: reply.slice(0, 1000),
      voice: selectedVoice || settings.ttsVoice || engine.defaultVoice,
      speed: settings.ttsSpeed || 1,
    });
    const b64 = await blobToB64(blob);
    try { await playB64(b64, mime); }
    catch { showToast("音频自动播放被浏览器拦截，点一下页面再试", true); }
  } catch (err) {
    pending.bubble.textContent = "出错了：" + err.message;
  }
}

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
    showToast("拿不到麦克风权限：请允许浏览器使用麦克风", true);
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
  recTimer = setTimeout(() => stopRecord(onDone), MAX_RECORD_MS);
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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
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
    const key = (settings[engine.keyField] || "").trim();
    if (!key) throw new Error(`还没配置「${engine.label}」的 Key，点右上角 ⚙️ 设置`);
    const text = await engine.asr(key, blob, "record.wav");
    pending.wrap.remove();
    if (!text.trim()) { showToast("没听清你说的话，再试一次？", true); return; }
    await askAndReply(text);
  } catch (err) {
    pending.wrap.remove();
    showToast(err.message, true, 6000);
  } finally {
    busy = false; sendBtn.disabled = false; micBtn.disabled = false;
  }
}

/* ---------------- 对话模型列表 ---------------- */

async function refreshLlms() {
  llmSelect.innerHTML = "";
  const ready = new Set(llmReadyIds(settings));
  for (const p of LLM_PRESETS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    const model = p.id === "custom" ? (settings.customLlmModel || "未填模型名") : (settings[`${p.id}Model`] || p.model);
    opt.textContent = ready.has(p.id) ? `${p.label}（${model}）` : `${p.label} 🔒`;
    opt.disabled = !ready.has(p.id);
    llmSelect.appendChild(opt);
  }
  const readyIds = [...ready];
  if (!readyIds.includes(selectedLlm)) selectedLlm = settings.defaultLlm || readyIds[0] || "";
  if (selectedLlm) {
    llmSelect.value = selectedLlm;
  } else {
    const placeholder = document.createElement("option");
    placeholder.textContent = "先到 ⚙️ 设置配任意一家的 KEY";
    placeholder.disabled = true;
    placeholder.selected = true;
    llmSelect.appendChild(placeholder);
  }
}

llmSelect.addEventListener("change", () => {
  selectedLlm = llmSelect.value;
  localStorage.setItem("voicelab_llm", selectedLlm);
});

/* ---------------- 音色列表 ---------------- */

function renderVoices(serverVoices) {
  const local = customVoices.filter((v) => v.provider === settings.engine);
  const builtin = serverVoices.filter((v) => v.builtin !== false);
  const cloudCustom = serverVoices.filter((v) => v.builtin === false);

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
  add("云端克隆音色", cloudCustom);
  add("本机克隆音色", local);

  if (selectedVoice && [...voiceSelect.options].some((o) => o.value === selectedVoice)) {
    voiceSelect.value = selectedVoice;
  } else {
    selectedVoice = voiceSelect.value || (serverVoices[0] && serverVoices[0].id) || "";
  }
}

async function refreshVoices() {
  try {
    const key = (settings[engine.keyField] || "").trim();
    renderVoices(await engine.listVoices(key));
  } catch (err) {
    renderVoices([]);
    showToast(err.message, true);
  }
}

voiceSelect.addEventListener("change", () => { selectedVoice = voiceSelect.value; });

$("#try-voice").addEventListener("click", async () => {
  if (!selectedVoice) return showToast("先选一个音色", true);
  const key = (settings[engine.keyField] || "").trim();
  if (!key) return showToast(`还没配置「${engine.label}」的 Key，点右上角 ⚙️ 设置`, true);
  try {
    const { blob, mime } = await engine.tts(key, {
      text: "你好，我是你选择的音色，来听听看吧。",
      voice: selectedVoice,
      speed: settings.ttsSpeed || 1,
    });
    playB64(await blobToB64(blob), mime);
  } catch (err) { showToast(err.message, true); }
});

$("#refresh-voices").addEventListener("click", refreshVoices);

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
  const key = (settings[engine.keyField] || "").trim();
  if (!key) return showToast(`还没配置「${engine.label}」的 Key，点右上角 ⚙️ 设置`, true);
  if (!name) return showToast("先给音色起个名字", true);
  if (!audio) return showToast("先录音或选择一个参考音频（wav/mp3）", true);

  busy = true;
  const btn = $("#clone-submit");
  btn.disabled = true; btn.textContent = "克隆中…（约十几秒）";
  try {
    const voice = await engine.createVoice(key, {
      name, blob: audio, filename: refBlob ? "reference.wav" : refFile.name, refText,
    });
    customVoices.push({ provider: settings.engine, id: voice.id, name: voice.name });
    saveCustomVoices();
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

/* ---------------- 调音台 UI（与网页版一致） ---------------- */

const KNOB_DEFS = [
  { id: "bright", label: "明暗" },
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
      const v = startVal + (startY - e.clientY) / 1.2;
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

$("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

/* ---------------- 初始化 ---------------- */

(async function init() {
  sendBtn.addEventListener("click", sendText);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); }
  });

  const { settings: s } = await chrome.storage.local.get("settings");
  settings = s || {};
  engine = VOICE_ENGINES[settings.engine] || VOICE_ENGINES.zhipu;

  const key = (settings[engine.keyField] || "").trim();
  $("#provider-badge").textContent = `语音引擎：${engine.label}`;
  $("#key-status").classList.toggle("ok", !!key);
  $("#key-status").title = key ? "Key 已配置" : "Key 未配置，点 ⚙️ 设置";
  if (!key) showToast(`还没配置「${engine.label}」的 Key，点右上角 ⚙️ 设置`, true, 8000);

  buildKnobs();
  refreshLlms();
  refreshVoices();
})();
