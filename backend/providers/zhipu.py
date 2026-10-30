"""智谱 BigModel（open.bigmodel.cn）。

接口来源（2026-10 官方文档）：
- 对话   POST /chat/completions           （glm-4-flash 免费档）
- 合成   POST /audio/speech               model=glm-tts，返回 wav
- 识别   POST /audio/transcriptions       model=glm-asr-2512，wav/mp3、≤30s
- 克隆   POST /files(purpose=voice-clone-input) → POST /voice/clone
         3~30 秒 mp3/wav ≤10M，返回的 voice id 直接用作合成 voice 参数
"""
import httpx

from .base import Provider, ProviderError, Voice

BASE = "https://open.bigmodel.cn/api/paas/v4"
TTS_MODEL = "glm-tts"
ASR_MODEL = "glm-asr-2512"


class ZhipuProvider(Provider):
    name = "zhipu"
    label = "智谱 BigModel"
    key_env = "ZHIPU_API_KEY"
    capabilities = ("chat", "tts", "asr", "clone")
    default_voice = "female"
    # 内置音色 id 表以官方文档为准，可经 .env 的 TTS_VOICE 覆盖
    builtin_voices = [Voice("female", "女声（默认示例音色）")]

    def __init__(self, api_key: str, llm_model: str = ""):
        self.api_key = api_key
        self.llm_model = llm_model or "glm-4-flash"

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    @staticmethod
    def _check(resp: httpx.Response, action: str) -> None:
        if resp.status_code < 400:
            return
        try:
            detail = resp.json().get("error", {}).get("message", "") or resp.text[:200]
        except Exception:
            detail = resp.text[:200]
        raise ProviderError(f"智谱{action}失败（HTTP {resp.status_code}）：{detail}")

    async def chat(self, messages: list[dict]) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{BASE}/chat/completions",
                headers=self._headers(),
                json={"model": self.llm_model, "messages": messages, "temperature": 0.8},
            )
        self._check(r, "对话")
        return r.json()["choices"][0]["message"]["content"]

    async def tts(self, text: str, voice: str, speed: float = 1.0) -> tuple[bytes, str]:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{BASE}/audio/speech",
                headers=self._headers(),
                json={
                    "model": TTS_MODEL,
                    "input": text,
                    "voice": voice or self.default_voice,
                    "speed": speed,
                    "response_format": "wav",
                },
            )
        self._check(r, "语音合成")
        return r.content, "audio/wav"

    async def asr(self, audio: bytes, filename: str = "audio.wav") -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{BASE}/audio/transcriptions",
                headers=self._headers(),
                files={"file": (filename, audio, "audio/wav")},
                data={"model": ASR_MODEL},
            )
        self._check(r, "语音识别")
        return r.json().get("text", "")

    async def create_voice(
        self, name: str, audio: bytes, filename: str, ref_text: str
    ) -> Voice:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{BASE}/files",
                headers=self._headers(),
                files={"file": (filename, audio)},
                data={"purpose": "voice-clone-input"},
            )
            self._check(r, "上传克隆音频")
            file_id = r.json()["id"]

            body = {
                "model": "glm-tts-clone",
                "voice_name": name,
                "file_id": file_id,
                # input 是官方要求的试听文本，随便给一句
                "input": f"你好，我是{name}，很高兴认识你。",
            }
            if ref_text:
                body["text"] = ref_text
            r2 = await client.post(
                f"{BASE}/voice/clone", headers=self._headers(), json=body
            )
        self._check(r2, "音色克隆")
        voice_id = r2.json().get("voice")
        if not voice_id:
            raise ProviderError(f"智谱克隆返回里没有 voice 字段：{r2.text[:200]}")
        return Voice(voice_id, name, builtin=False)
