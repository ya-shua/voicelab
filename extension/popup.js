/* 弹窗：显示配置状态 + 两个入口 */
"use strict";

async function render() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = settings || {};
  const engine = s.engine === "siliconflow" ? "硅基流动" : "智谱 BigModel";
  const keyField = s.engine === "siliconflow" ? "sfKey" : "zhipuKey";
  const hasVoiceKey = !!(s[keyField] || "").trim();
  const llmKeys = ["zhipuKey", "sfKey", "deepseekKey", "moonshotKey", "dashscopeKey", "openaiKey", "openrouterKey", "customLlmKey"];
  const llmReady = llmKeys.some((k) => (s[k] || "").trim());

  document.getElementById("status").innerHTML =
    `语音引擎：${engine}<br>` +
    `<span class="dot ${hasVoiceKey ? "ok" : ""}"></span>语音 Key ${hasVoiceKey ? "已配置" : "未配置"}<br>` +
    `<span class="dot ${llmReady ? "ok" : ""}"></span>对话模型 Key ${llmReady ? "至少配了一家" : "未配置"}`;
}

document.getElementById("open-main").addEventListener("click", () => {
  chrome.tabs.create({ url: "main.html" });
  window.close();
});
document.getElementById("open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

render();
