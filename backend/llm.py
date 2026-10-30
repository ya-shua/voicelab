"""对话大模型层：凡是 OpenAI 兼容的 /chat/completions 都走这里。

内置常见厂商预设（见 PRESETS）；其它服务（Ollama、vLLM、LM Studio、第三方中转…）
用 custom 预设：填 CUSTOM_LLM_BASE_URL / CUSTOM_LLM_API_KEY / CUSTOM_LLM_MODEL。
每个预设的模型名可用 <ID大写>_LLM_MODEL 覆盖，例如 DEEPSEEK_LLM_MODEL=deepseek-reasoner。
"""
from dataclasses import dataclass

import httpx

from backend import config
from backend.providers.base import MissingKeyError, ProviderError


@dataclass
class LlmPreset:
    id: str
    label: str
    base_url: str
    model: str
    key_env: str
    note: str = ""


PRESETS = [
    LlmPreset("zhipu", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4",
              "glm-4-flash", "ZHIPU_API_KEY", "glm-4-flash 免费"),
    LlmPreset("siliconflow", "硅基流动", "https://api.siliconflow.cn/v1",
              "Qwen/Qwen2.5-7B-Instruct", "SILICONFLOW_API_KEY", "Qwen2.5-7B 免费"),
    LlmPreset("deepseek", "DeepSeek", "https://api.deepseek.com/v1",
              "deepseek-chat", "DEEPSEEK_API_KEY"),
    LlmPreset("moonshot", "月之暗面 Kimi", "https://api.moonshot.cn/v1",
              "moonshot-v1-8k", "MOONSHOT_API_KEY"),
    LlmPreset("dashscope", "阿里百炼 Qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1",
              "qwen-flash", "DASHSCOPE_API_KEY"),
    LlmPreset("openai", "OpenAI", "https://api.openai.com/v1",
              "gpt-4o-mini", "OPENAI_API_KEY"),
    LlmPreset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1",
              "openrouter/auto", "OPENROUTER_API_KEY", "一个 key 调多家模型"),
    LlmPreset("custom", "自定义（Ollama / vLLM / 中转）", "",
              "", "CUSTOM_LLM_API_KEY", "需填 CUSTOM_LLM_BASE_URL 和 CUSTOM_LLM_MODEL"),
]


def _base_url(p: LlmPreset) -> str:
    return config.CUSTOM_LLM_BASE_URL if p.id == "custom" else p.base_url


def _model(p: LlmPreset) -> str:
    if p.id == "custom":
        return config.CUSTOM_LLM_MODEL
    return config.env(f"{p.id.upper()}_LLM_MODEL") or p.model


def _key(p: LlmPreset) -> str:
    return getattr(config, p.key_env, "")


def list_llms() -> list[dict]:
    return [
        {
            "id": p.id,
            "label": p.label,
            "model": _model(p),
            "ready": bool(_key(p)) and bool(_base_url(p)) and bool(_model(p)),
            "key_env": p.key_env,
            "note": p.note,
        }
        for p in PRESETS
    ]


def pick_default_llm() -> str | None:
    """默认对话模型：LLM_PROVIDER 指定的优先，否则第一个配了 key 的。"""
    ready = [item["id"] for item in list_llms() if item["ready"]]
    if config.LLM_PROVIDER in ready:
        return config.LLM_PROVIDER
    return ready[0] if ready else None


def find_preset(preset_id: str) -> LlmPreset:
    for p in PRESETS:
        if p.id == preset_id:
            return p
    raise ProviderError(
        f"没有叫 {preset_id!r} 的对话模型，可选：{'、'.join(p.id for p in PRESETS)}"
    )


async def chat_completion(preset_id: str, messages: list[dict]) -> tuple[str, str]:
    """调对话模型，返回 (回复文本, 展示用的「厂商 · 模型」标签)。"""
    p = find_preset(preset_id)
    base, key, model = _base_url(p), _key(p), _model(p)
    if not (key and base and model):
        extra = "、CUSTOM_LLM_BASE_URL、CUSTOM_LLM_MODEL" if p.id == "custom" else ""
        raise MissingKeyError(
            f"要用「{p.label}」对话，先在 .env 里配置 {p.key_env}{extra}，然后重启服务。"
        )
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            base.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model, "messages": messages, "temperature": 0.8},
        )
    if r.status_code >= 400:
        try:
            body = r.json()
            detail = (
                body.get("error", {}).get("message")
                or body.get("message")
                or str(body)[:200]
            )
        except Exception:
            detail = r.text[:200]
        raise ProviderError(f"{p.label} 对话失败（HTTP {r.status_code}）：{detail}")
    text = r.json()["choices"][0]["message"]["content"]
    return text, f"{p.label} · {model}"
