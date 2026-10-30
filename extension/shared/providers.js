/* VoiceLab 共享数据层：从 Python 后端移植的云服务调用（BYOK，Key 存 chrome.storage）。
   语音引擎（TTS/ASR/克隆）与对话模型（OpenAI 兼容）解耦，与网页版 backend/ 保持同构。 */

const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";
const SF_BASE = "https://api.siliconflow.cn/v1";
const SF_TTS_MODEL = "FunAudioLLM/CosyVoice2-0.5B";

async function readErr(res, label) {
  let detail = "";
  try {
    const body = await res.json();
    detail = (body.error && body.error.message) || body.message || JSON.stringify(body).slice(0, 200);
  } catch {
    detail = "";
  }
  if (!detail) detail = (await res.text().catch(() => "")).slice(0, 200);
  return new Error(`${label}失败（HTTP ${res.status}）：${detail}`);
}

const jsonHeaders = (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

/* ---------------- 语音引擎 ---------------- */

export const VOICE_ENGINES = {
  zhipu: {
    id: "zhipu",
    label: "智谱 BigModel",
    keyField: "zhipuKey",
    defaultVoice: "female",
    builtins: [{ id: "female", name: "女声（默认示例音色）" }],

    async chat(key, model, messages) {
      const r = await fetch(`${ZHIPU_BASE}/chat/completions`, {
        method: "POST",
        headers: jsonHeaders(key),
        body: JSON.stringify({ model: model || "glm-4-flash", messages, temperature: 0.8 }),
      });
      if (!r.ok) throw await readErr(r, "智谱对话");
      return (await r.json()).choices[0].message.content;
    },

    async tts(key, { text, voice, speed }) {
      const r = await fetch(`${ZHIPU_BASE}/audio/speech`, {
        method: "POST",
        headers: jsonHeaders(key),
        body: JSON.stringify({
          model: "glm-tts",
          input: text,
          voice: voice || this.defaultVoice,
          speed: speed || 1,
          response_format: "wav",
        }),
      });
      if (!r.ok) throw await readErr(r, "智谱语音合成");
      return { blob: await r.blob(), mime: "audio/wav" };
    },

    async asr(key, blob, filename) {
      const fd = new FormData();
      fd.append("file", blob, filename || "audio.wav");
      fd.append("model", "glm-asr-2512");
      const r = await fetch(`${ZHIPU_BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fd,
      });
      if (!r.ok) throw await readErr(r, "智谱语音识别");
      return (await r.json()).text || "";
    },

    async createVoice(key, { name, blob, filename, refText }) {
      const fd = new FormData();
      fd.append("file", blob, filename || "reference.wav");
      fd.append("purpose", "voice-clone-input");
      let r = await fetch(`${ZHIPU_BASE}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fd,
      });
      if (!r.ok) throw await readErr(r, "智谱上传克隆音频");
      const fileId = (await r.json()).id;

      const body = {
        model: "glm-tts-clone",
        voice_name: name,
        file_id: fileId,
        input: `你好，我是${name}，很高兴认识你。`,
      };
      if (refText) body.text = refText;
      r = await fetch(`${ZHIPU_BASE}/voice/clone`, {
        method: "POST",
        headers: jsonHeaders(key),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw await readErr(r, "智谱音色克隆");
      const voiceId = (await r.json()).voice;
      if (!voiceId) throw new Error("智谱克隆返回里没有 voice 字段");
      return { id: voiceId, name };
    },

    async listVoices() {
      return this.builtins; // 智谱没有音色列表接口，克隆音色记在浏览器本地
    },
  },

  siliconflow: {
    id: "siliconflow",
    label: "硅基流动",
    keyField: "sfKey",
    defaultVoice: `${SF_TTS_MODEL}:alex`,
    builtins: [
      ["alex", "男声·沉稳"], ["benjamin", "男声·低沉"], ["charles", "男声·磁性"], ["david", "男声·欢快"],
      ["anna", "女声·沉稳"], ["bella", "女声·激情"], ["claire", "女声·温柔"], ["diana", "女声·欢快"],
    ].map(([vid, name]) => ({ id: `${SF_TTS_MODEL}:${vid}`, name })),

    async chat(key, model, messages) {
      const r = await fetch(`${SF_BASE}/chat/completions`, {
        method: "POST",
        headers: jsonHeaders(key),
        body: JSON.stringify({ model: model || "Qwen/Qwen2.5-7B-Instruct", messages, temperature: 0.8 }),
      });
      if (!r.ok) throw await readErr(r, "硅基流动对话");
      return (await r.json()).choices[0].message.content;
    },

    async tts(key, { text, voice, speed }) {
      let v = voice || this.defaultVoice;
      if (!v.startsWith("speech:") && !v.includes(":")) v = `${SF_TTS_MODEL}:${v}`;
      const r = await fetch(`${SF_BASE}/audio/speech`, {
        method: "POST",
        headers: jsonHeaders(key),
        body: JSON.stringify({
          model: SF_TTS_MODEL,
          input: text,
          voice: v,
          response_format: "mp3",
          speed: speed || 1,
        }),
      });
      if (!r.ok) throw await readErr(r, "硅基流动语音合成");
      return { blob: await r.blob(), mime: "audio/mpeg" };
    },

    async asr(key, blob, filename) {
      const fd = new FormData();
      fd.append("file", blob, filename || "audio.wav");
      fd.append("model", "FunAudioLLM/SenseVoiceSmall");
      const r = await fetch(`${SF_BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fd,
      });
      if (!r.ok) throw await readErr(r, "硅基流动语音识别");
      return (await r.json()).text || "";
    },

    async createVoice(key, { name, blob, filename, refText }) {
      const fd = new FormData();
      fd.append("file", blob, filename || "reference.wav");
      fd.append("model", SF_TTS_MODEL);
      fd.append("customName", name);
      fd.append("text", refText || "这段音频将作为音色克隆的参考。");
      const r = await fetch(`${SF_BASE}/uploads/audio/voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fd,
      });
      if (!r.ok) throw await readErr(r, "硅基流动音色克隆（注意：账号需先完成实名认证）");
      const uri = (await r.json()).uri;
      if (!uri) throw new Error("硅基流动克隆返回里没有 uri 字段");
      return { id: uri, name };
    },

    async listVoices(key) {
      try {
        const r = await fetch(`${SF_BASE}/audio/voice/list`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!r.ok) return this.builtins;
        const data = await r.json();
        const items = Array.isArray(data) ? data : (data.result || data.data || data.voices || []);
        const custom = [];
        for (const it of items) {
          if (!it || !it.uri) continue;
          custom.push({ id: it.uri, name: it.customName || it.name || it.uri.split(":")[1], builtin: false });
        }
        return [...this.builtins, ...custom];
      } catch {
        return this.builtins;
      }
    },
  },
};

/* ---------------- 对话大模型层（OpenAI 兼容） ---------------- */

export const LLM_PRESETS = [
  { id: "zhipu", label: "智谱 GLM", baseUrl: ZHIPU_BASE, model: "glm-4-flash", keyField: "zhipuKey", note: "glm-4-flash 免费" },
  { id: "siliconflow", label: "硅基流动", baseUrl: SF_BASE, model: "Qwen/Qwen2.5-7B-Instruct", keyField: "sfKey", note: "Qwen2.5-7B 免费" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyField: "deepseekKey" },
  { id: "moonshot", label: "月之暗面 Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", keyField: "moonshotKey" },
  { id: "dashscope", label: "阿里百炼 Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-flash", keyField: "dashscopeKey" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyField: "openaiKey" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", keyField: "openrouterKey", note: "一个 key 调多家模型" },
  { id: "custom", label: "自定义（Ollama / vLLM / 中转）", baseUrl: "", model: "", keyField: "customLlmKey", note: "在设置里填 Base URL 和模型名" },
];

function presetParts(settings, p) {
  const key = (settings[p.keyField] || "").trim();
  const base = p.id === "custom" ? (settings.customLlmBase || "").trim() : p.baseUrl;
  const model = p.id === "custom" ? (settings.customLlmModel || "").trim() : (settings[`${p.id}Model`] || "").trim() || p.model;
  return { key, base, model };
}

export function llmReadyIds(settings) {
  return LLM_PRESETS.filter((p) => {
    const { key, base, model } = presetParts(settings, p);
    return key && base && model;
  }).map((p) => p.id);
}

export async function llmChat(settings, presetId, messages) {
  const p = LLM_PRESETS.find((x) => x.id === presetId);
  if (!p) throw new Error(`没有叫 ${presetId} 的对话模型`);
  const { key, base, model } = presetParts(settings, p);
  if (!key || !base || !model) {
    throw new Error(`要用「${p.label}」对话，请到扩展设置里填好对应的 Key${p.id === "custom" ? "、Base URL 和模型名" : ""}`);
  }
  const r = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: jsonHeaders(key),
    body: JSON.stringify({ model, messages, temperature: 0.8 }),
  });
  if (!r.ok) throw await readErr(r, `${p.label}对话`);
  const text = (await r.json()).choices[0].message.content;
  return { text, label: `${p.label} · ${model}` };
}

/* ---------------- 公共小工具 ---------------- */

export function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = () => reject(new Error("音频读取失败"));
    fr.readAsDataURL(blob);
  });
}
