# 🎙️ VoiceLab · 声音实验室

一个接云端 API 的语音小实验室：**语音聊天**（你说一句、它用你选的音色回一句）、
**多家大模型自由切换**、**音色克隆**（3 秒起步的参考音频克隆出专属音色）。
纯 API 调用，本地不需要显卡和大模型。

## 功能现状

| 功能 | 状态 | 说明 |
|---|---|---|
| 语音聊天（录音→识别→对话→合成朗读） | ✅ 可用 | 按住 🎤 或直接打字 |
| 对话大模型自由切换 | ✅ 可用 | 内置 8 家预设 + 自定义接入，见下表 |
| 音色调音台 | ✅ 可用 | 明暗/冷暖/厚度/泛音四个实时旋钮，暖声/清亮预设 |
| 音色克隆 | ✅ 可用 | 智谱 3~30 秒音频 / 硅基流动 8~10 秒音频 |
| 音色库 + 对外 TTS 接口 | ✅ 可用 | OpenAI 兼容 `/v1/audio/speech`，酒馆/QQ 机器人/Discord 直接挂 |
| 唱歌转换 / 稳定音色翻唱 | 🚧 下一里程碑 | QQ/Discord 点歌 → 分离 API + 歌声转换 API → 文件回传 |
| MIDI 干声合成（不跑调唱歌） | 🚧 规划中 | Synth V / X Studio 出干声再转换（桌面混合形态） |

## 能接哪些大模型？

所有 **OpenAI 兼容接口**的模型都能接。内置预设（在 `.env` 里填对应 KEY，页面的
「对话模型」下拉就会多出这一家）：

| 预设 id | 厂商 | 默认模型 | KEY 获取 |
|---|---|---|---|
| `zhipu` | 智谱 GLM | glm-4-flash（免费） | https://open.bigmodel.cn |
| `siliconflow` | 硅基流动 | Qwen2.5-7B（免费档） | https://cloud.siliconflow.cn |
| `deepseek` | DeepSeek | deepseek-chat | https://platform.deepseek.com |
| `moonshot` | 月之暗面 Kimi | moonshot-v1-8k | https://platform.moonshot.cn |
| `dashscope` | 阿里百炼 Qwen | qwen-flash | https://bailian.console.aliyun.com |
| `openai` | OpenAI | gpt-4o-mini | https://platform.openai.com |
| `openrouter` | OpenRouter | openrouter/auto | https://openrouter.ai |
| `custom` | 自定义 | — | Ollama / vLLM / LM Studio / 中转站 |

**接本地模型（Ollama）示例**：

```ini
CUSTOM_LLM_BASE_URL=http://127.0.0.1:11434/v1
CUSTOM_LLM_MODEL=qwen2.5:7b
CUSTOM_LLM_API_KEY=ollama   # 本地不用鉴权，填任意非空值
```

换某家的默认模型：`DEEPSEEK_LLM_MODEL=deepseek-reasoner` 这样覆盖。
新增其它厂商：在 `backend/llm.py` 的 `PRESETS` 里加一行即可。

## 快速开始

1. **申请 API Key**（语音引擎二选一；对话模型想用哪家填哪家）：
   - 智谱 BigModel：https://open.bigmodel.cn → 「API Keys」→ 新建
   - 硅基流动：https://cloud.siliconflow.cn/account/ak → 新建（克隆音色需先实名认证）
2. **双击 `start.bat`**。首次运行会自动建虚拟环境、装依赖，然后弹出 `.env` 让你填 key：
   ```ini
   VOICE_PROVIDER=zhipu      # 语音引擎：zhipu 或 siliconflow
   ZHIPU_API_KEY=你的key     # 语音 + 智谱对话共用这一个 key
   ```
   填完保存，**再双击一次 `start.bat`**，浏览器会自动打开 http://127.0.0.1:8787

不想用 bat 的话手动跑：

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8787
```

## 使用说明

- **切模型**：右侧「对话模型」下拉，🔒 的说明还没配那家的 KEY；回复气泡下方会标注
  这句话是哪家模型生成的。
- **调音色**：右侧「音色调音台」四个旋钮实时作用于播放中的声音——
  **明暗**（5kHz 搁架）、**冷暖**（320Hz 峰值）、**厚度**（170Hz 峰值+压缩）、
  **泛音**（软削波谐波激励）。上拖增大、下拖减小、双击回中位；「🔥 暖声 / ✨ 清亮」
  一键预设，「原声对比」旁路调音台听原始声音。参数存在本机浏览器。
  注意：调音台改变的是**播放效果**，不改变音色文件本身（要把效果烧进音频文件，
  属于后续翻唱里程碑里 ffmpeg 后处理的活）。
- **聊天**：输入文字或点 🎤 录音（最长 28 秒）→ 助手回复并朗读。
- **克隆音色**：右侧「克隆新音色」→ 起名字 → 写下音频里念的文字稿（更准）→
  「🎤 录一段」或「📂 选文件」上传 wav/mp3 → 开始克隆 → 完成后自动选中，点「试听」验证。
- 克隆出来的音色 id 保存在**本机浏览器**（localStorage），换浏览器/清缓存后需要重新克隆
  （硅基流动的克隆音色在云端，点 ↻ 可以重新拉取）。

## 给别的 AI 配音色（对外接口）

克隆出来的音色会进入**音色库**（服务端 `data/voices.json`，跨浏览器共享），
并通过 OpenAI 兼容接口暴露给任意聊天平台。在 `.env` 里设置 `VOICELAB_TOKEN`
作为访问口令（留空则不鉴权，仅建议纯本机自用）。

接口（鉴权方式都是请求头 `Authorization: Bearer <VOICELAB_TOKEN>`）：

| 端点 | 说明 |
|---|---|
| `POST /v1/audio/speech` | OpenAI TTS 格式：`{"input": "要说的话", "voice": "音色名或id"}`，直接返回音频 |
| `GET /v1/voices` | 列出可用音色（内置 + 音色库），非 OpenAI 标准，方便平台做下拉 |
| `GET /v1/models` | OpenAI models 格式，给会先探测模型的客户端 |

**SillyTavern（酒馆）接入**：Extensions → TTS → Provider 选 **OpenAI Compatible**，
API Base URL 填 `http://127.0.0.1:8787/v1`（同机）或 `http://<你的IP>:8787/v1`，
API Key 填 `VOICELAB_TOKEN` 的值，voice 填音色库里的名字即可。

**curl 验证**：

```bash
curl http://127.0.0.1:8787/v1/audio/speech \
  -H "Authorization: Bearer 你的token" \
  -H "Content-Type: application/json" \
  -d '{"input":"你好呀","voice":"我的音色"}' --output hello.wav
```

音色的 `voice` 参数三选一：音色库里的**名字**、库里的 **id**（如 `speech:xxx`）、
或引擎**内置音色 id**（如 `female`）。返回格式由当前语音引擎决定（智谱=wav，硅基流动=mp3）。

注意：把服务暴露到局域网/公网给平台用之前，**务必设置 VOICELAB_TOKEN**；
克隆音色仅限本人或已授权声音。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 提示「还没配置 ZHIPU_API_KEY」 | `.env` 没填或没保存，填完重启服务 |
| 对话模型下拉里全是 🔒 | 一家 KEY 都没配；至少配一个（智谱/硅基流动注册即有） |
| 某家模型报 401 | 那家的 KEY 抄错或被删了，回官网重新生成 |
| 点 🎤 没反应 | 浏览器只在 localhost / https 下给麦克风权限；换 Chrome/Edge 试试 |
| 克隆报错 | 智谱要求 3~30 秒、mp3/wav、≤10MB；硅基流动要求账号已完成实名认证 |
| 音色用了别人的声音 | 不行。只克隆自己或已获授权的声音 |

## 项目结构

```
voicelab/
├─ start.bat              # Windows 一键启动
├─ .env.example           # 配置模板（复制为 .env 后填写）
├─ requirements.txt
├─ backend/
│  ├─ main.py             # FastAPI 路由：/api/chat /api/llms /api/asr /api/tts /api/voices + 对外 /v1/*
│  ├─ config.py           # 读取 .env
│  ├─ llm.py              # 对话大模型层：OpenAI 兼容预设表 + custom 自定义接入
│  ├─ voice_library.py    # 音色库：克隆音色的服务端档案（data/voices.json）
│  └─ providers/          # 语音引擎适配层（每家云服务一个文件，接口统一）
│     ├─ base.py          # 公共约定
│     ├─ zhipu.py         # 智谱：glm-tts + glm-asr + 音色复刻
│     └─ siliconflow.py   # 硅基流动：CosyVoice2 + SenseVoice + 自定义音色
├─ frontend/              # 无框架静态页（vanilla JS，浏览器直接录 16k WAV），含 PWA
└─ extension/             # 浏览器扩展版（无需后端，见 extension/README.md）
```

对话模型与语音引擎是**解耦的**：换 TTS 引擎不影响你用哪家大模型，反之亦然。
想接入新的语音引擎？照着 `providers/zhipu.py` 实现五个方法，在 `providers/__init__.py`
注册一下就行。

## 合规声明（重要）

- 本项目采用 **BYOK**（用户自带 API Key）：key 只存在你自己的 `.env` 里，绝不打包、
  绝不提交进仓库（`.env` 已在 `.gitignore`）。
- 音色克隆**仅限本人或已获书面授权的声音**；未经授权模仿他人声音违法（民法典第 1023 条，
  声音参照肖像权保护）。
- 后续翻唱功能产生的作品如对外发布，请遵守各服务平台条款并向听众披露 AI 生成属性；
  翻唱涉及的词曲著作权由使用者自行解决。

## License

MIT
