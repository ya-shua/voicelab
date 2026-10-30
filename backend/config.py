"""读取 .env 配置。所有配置都从环境变量来，仓库里只放 .env.example。"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"


def _load_dotenv() -> None:
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


# ===== 语音引擎（TTS / ASR / 音色克隆）=====
PROVIDER = env("VOICE_PROVIDER", "zhipu").lower()
ZHIPU_API_KEY = env("ZHIPU_API_KEY")
SILICONFLOW_API_KEY = env("SILICONFLOW_API_KEY")

# ===== 对话大模型 =====
# 默认用哪家（可选 id 见 backend/llm.py 的 PRESETS）；留空则自动挑第一个配了 key 的
LLM_PROVIDER = env("LLM_PROVIDER")
# 各家 key：用哪家填哪家，接口全部 OpenAI 兼容
DEEPSEEK_API_KEY = env("DEEPSEEK_API_KEY")
MOONSHOT_API_KEY = env("MOONSHOT_API_KEY")
DASHSCOPE_API_KEY = env("DASHSCOPE_API_KEY")
OPENAI_API_KEY = env("OPENAI_API_KEY")
OPENROUTER_API_KEY = env("OPENROUTER_API_KEY")
# 自定义接入（Ollama / vLLM / LM Studio / 中转站…）
CUSTOM_LLM_BASE_URL = env("CUSTOM_LLM_BASE_URL")
CUSTOM_LLM_API_KEY = env("CUSTOM_LLM_API_KEY")
CUSTOM_LLM_MODEL = env("CUSTOM_LLM_MODEL")

# ===== 通用（留空用默认）=====
# 对外 /v1/* 接口的门禁：设置后必须带 Authorization: Bearer <token>；留空 = 不鉴权（仅本机用）
VOICELAB_TOKEN = env("VOICELAB_TOKEN")
# 语音引擎自带对话模型的模型名覆盖（仅在不启用独立 LLM 层时生效）
LLM_MODEL = env("LLM_MODEL")
TTS_VOICE = env("TTS_VOICE")
TTS_SPEED = float(env("TTS_SPEED", "1.0"))
