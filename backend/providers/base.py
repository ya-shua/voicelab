"""各家 API 的公共接口约定。

每个 provider 实现五个能力（按 capabilities 声明自己支持哪些）：
chat（LLM 对话）、tts（文字转语音）、asr（语音转文字）、
create_voice / list_voices（音色克隆与列表）。
"""
from dataclasses import dataclass


class ProviderError(Exception):
    """调用上游 API 失败，message 面向用户（中文）。"""


class MissingKeyError(Exception):
    """对应厂商的 API Key 没有配置。"""


@dataclass
class Voice:
    id: str          # 传给 TTS voice 参数的值
    name: str        # 界面显示名
    builtin: bool = True


class Provider:
    name = "base"
    label = ""
    key_env = ""
    api_key = ""
    capabilities: tuple = ()
    builtin_voices: list[Voice] = []
    default_voice = ""

    async def chat(self, messages: list[dict]) -> str:
        raise NotImplementedError

    async def tts(self, text: str, voice: str, speed: float = 1.0) -> tuple[bytes, str]:
        """返回 (音频字节, MIME 类型)。"""
        raise NotImplementedError

    async def asr(self, audio: bytes, filename: str = "audio.wav") -> str:
        raise NotImplementedError

    async def create_voice(
        self, name: str, audio: bytes, filename: str, ref_text: str
    ) -> Voice:
        raise NotImplementedError

    async def list_voices(self) -> list[Voice]:
        return list(self.builtin_voices)
