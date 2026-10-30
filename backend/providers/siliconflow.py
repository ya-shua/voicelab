"""硅基流动 SiliconFlow（api.siliconflow.cn，OpenAI 兼容）。

接口来源（2026-10 官方文档）：
- 对话   POST /chat/completions           （Qwen2.5-7B 免费档）
- 合成   POST /audio/speech               CosyVoice2-0.5B，mp3/wav
- 识别   POST /audio/transcriptions       SenseVoiceSmall（免费）
- 克隆   POST /uploads/audio/voice        8~10 秒参考音频 + 文稿，返回 speech:xxx URI
- 列表   GET  /audio/voice/list
注意：克隆需账号完成实名认证。
"""
import httpx

from .base import Provider, ProviderError, Voice

BASE = "https://api.siliconflow.cn/v1"
TTS_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
ASR_MODEL = "FunAudioLLM/SenseVoiceSmall"

_BUILTIN = [
    ("alex", "男声·沉稳"), ("benjamin", "男声·低沉"),
    ("charles", "男声·磁性"), ("david", "男声·欢快"),
    ("anna", "女声·沉稳"), ("bella", "女声·激情"),
    ("claire", "女声·温柔"), ("diana", "女声·欢快"),
]


class SiliconFlowProvider(Provider):
    name = "siliconflow"
    label = "硅基流动"
    key_env = "SILICONFLOW_API_KEY"
    capabilities = ("chat", "tts", "asr", "clone")
    default_voice = f"{TTS_MODEL}:alex"
    builtin_voices = [Voice(f"{TTS_MODEL}:{vid}", name) for vid, name in _BUILTIN]

    def __init__(self, api_key: str, llm_model: str = ""):
        self.api_key = api_key
        self.llm_model = llm_model or "Qwen/Qwen2.5-7B-Instruct"

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    @staticmethod
    def _check(resp: httpx.Response, action: str) -> None:
        if resp.status_code < 400:
            return
        try:
            body = resp.json()
            detail = body.get("message") or body.get("error", {}).get("message", "") or str(body)[:200]
        except Exception:
            detail = resp.text[:200]
        raise ProviderError(f"硅基流动{action}失败（HTTP {resp.status_code}）：{detail}")

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
        # 内置音色要带模型前缀；克隆出来的 speech:xxx URI 原样使用
        if not voice:
            voice = self.default_voice
        elif not voice.startswith("speech:"):
            voice = f"{TTS_MODEL}:{voice}" if ":" not in voice else voice
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{BASE}/audio/speech",
                headers=self._headers(),
                json={
                    "model": TTS_MODEL,
                    "input": text,
                    "voice": voice,
                    "response_format": "mp3",
                    "speed": speed,
                },
            )
        self._check(r, "语音合成")
        return r.content, "audio/mpeg"

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
                f"{BASE}/uploads/audio/voice",
                headers=self._headers(),
                files={"file": (filename, audio)},
                data={
                    "model": TTS_MODEL,
                    "customName": name,
                    "text": ref_text or "这段音频将作为音色克隆的参考。",
                },
            )
        self._check(r, "音色克隆（注意：账号需先完成实名认证）")
        uri = r.json().get("uri")
        if not uri:
            raise ProviderError(f"硅基流动克隆返回里没有 uri 字段：{r.text[:200]}")
        return Voice(uri, name, builtin=False)

    async def list_voices(self) -> list[Voice]:
        custom: list[Voice] = []
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(
                    f"{BASE}/audio/voice/list", headers=self._headers()
                )
            self._check(r, "获取音色列表")
            data = r.json()
            items = data if isinstance(data, list) else (
                data.get("result") or data.get("data") or data.get("voices") or []
            )
            for item in items:
                if not isinstance(item, dict):
                    continue
                uri = item.get("uri")
                if not uri:
                    continue
                name = item.get("customName") or item.get("name") or uri.split(":")[1]
                custom.append(Voice(uri, name, builtin=False))
        except ProviderError:
            pass  # 列表拉不下来不阻塞聊天，内置音色仍可用
        return list(self.builtin_voices) + custom
