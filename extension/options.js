/* 设置页：读写 chrome.storage.local 的 settings 对象 */
"use strict";

const FIELDS = [
  "engine", "zhipuKey", "sfKey",
  "deepseekKey", "moonshotKey", "dashscopeKey", "openaiKey", "openrouterKey",
  "customLlmBase", "customLlmModel", "customLlmKey",
  "defaultLlm", "ttsVoice", "ttsSpeed",
];

const DEFAULTS = {
  engine: "zhipu", zhipuKey: "", sfKey: "",
  deepseekKey: "", moonshotKey: "", dashscopeKey: "", openaiKey: "", openrouterKey: "",
  customLlmBase: "", customLlmModel: "", customLlmKey: "",
  defaultLlm: "", ttsVoice: "", ttsSpeed: 1,
};

async function load() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULTS, ...(settings || {}) };
  for (const id of FIELDS) {
    const el = document.getElementById(id);
    if (el) el.value = s[id] ?? "";
  }
}

async function save() {
  const s = { ...DEFAULTS };
  for (const id of FIELDS) {
    const el = document.getElementById(id);
    s[id] = el.type === "number" ? parseFloat(el.value) || 1 : (el.value || "").trim();
  }
  await chrome.storage.local.set({ settings: s });
  const saved = document.getElementById("saved");
  saved.classList.add("show");
  setTimeout(() => saved.classList.remove("show"), 2000);
}

(async function init() {
  // 填充「默认对话模型」下拉（静态预设，与 shared/providers.js 一致）
  const presets = [
    ["", "自动（第一个配了 Key 的）"],
    ["zhipu", "智谱 GLM"], ["siliconflow", "硅基流动"], ["deepseek", "DeepSeek"],
    ["moonshot", "月之暗面 Kimi"], ["dashscope", "阿里百炼 Qwen"], ["openai", "OpenAI"],
    ["openrouter", "OpenRouter"], ["custom", "自定义"],
  ];
  const sel = document.getElementById("defaultLlm");
  for (const [v, t] of presets) {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  }
  document.getElementById("save").addEventListener("click", save);
  await load();
})();
