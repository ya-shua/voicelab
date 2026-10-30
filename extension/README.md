# 🧩 VoiceLab 浏览器扩展版

VoiceLab 的**浏览器扩展**形态：不需要 Python 后端，数据层直接调云 API（BYOK），
聊天、录音识别、音色克隆、音色调音台全部功能都在扩展里。

同一份代码可装进 **Chrome / Edge / Firefox**（桌面全系统 + 安卓 Firefox），
也是以后上架 Chrome Web Store / Edge 加载项 / Firefox Add-ons 的源码。

## 安装（开发者模式，无需上架）

**Chrome / Edge（推荐）：**
1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`）
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（`extension` 文件夹）
4. 工具栏出现 🎙️ 图标 → 点开 → 「打开工作台」

**Firefox：**
1. 打开 `about:debugging#/runtime/this-firefox`
2. 「临时载入附加组件」→ 选本目录的 `manifest.json`
3. 注意：Firefox 的临时载入重启浏览器后会失效，要永久使用需上架 AMO 签名（后续做）

## 配置

点工具栏图标 → 「⚙️ 设置」：
- **语音引擎**（二选一）：智谱 BigModel 或 硅基流动，填对应 API Key
- **对话模型**：DeepSeek / Kimi / 百炼 Qwen / OpenAI / OpenRouter，想用哪家填哪家
- 本地 Ollama：Base URL 填 `http://127.0.0.1:11434/v1`，模型名如 `qwen2.5:7b`，
  且需以 `OLLAMA_ORIGINS=*` 启动 Ollama 才允许扩展页面访问

Key 只存在浏览器本地（`chrome.storage.local`），绝不打包、不上传。

## 与网页版的关系

| | 网页版（voicelab/） | 扩展版（voicelab-extension/） |
|---|---|---|
| 运行依赖 | 本地 Python 后端 (FastAPI, 8787) | 无，纯浏览器 |
| 云 API 调用 | 后端转发 | 扩展页直接调（host_permissions） |
| 适合 | 本机深度使用、继续开发 | 装完就走、换电脑也能用 |
| 代码关系 | `providers/*.py` | `shared/providers.js`（同构移植） |

## 目录

```
voicelab-extension/
├─ manifest.json          MV3 清单（含 Firefox 兼容字段）
├─ popup.html/js          工具栏弹窗：状态 + 两个入口
├─ options.html/js        设置页：各家 API Key
├─ main.html/css/js       工作台：聊天/录音/调音台/克隆（与网页版同构）
├─ shared/providers.js    数据层：语音引擎 + LLM 预设（fetch 直调云 API）
├─ icons/                 图标（tools/gen_icons.py 生成）
└─ tools/gen_icons.py
```

## 上架（以后要做时）

- Chrome Web Store：打包 zip（目录里 `manifest.json` 需去掉 `browser_specific_settings`），
  开发者注册费 $5/次
- Edge 加载项：免费，同一份 zip
- Firefox Add-ons (AMO)：免费，需源码审查，保留 gecko id 字段

## 合规

BYOK：用户自带 Key；音色克隆仅限本人或已授权声音；录音与调音全部在本地浏览器完成，
只有调云 API 时音频会发给你自己配置的服务商。
