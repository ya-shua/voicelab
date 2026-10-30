from backend.config import LLM_MODEL, PROVIDER, SILICONFLOW_API_KEY, ZHIPU_API_KEY
from backend.providers.base import MissingKeyError, ProviderError, Voice
from backend.providers.siliconflow import SiliconFlowProvider
from backend.providers.zhipu import ZhipuProvider

PROVIDERS = {
    "zhipu": ZhipuProvider,
    "siliconflow": SiliconFlowProvider,
}


def get_provider():
    cls = PROVIDERS.get(PROVIDER)
    if cls is None:
        raise ProviderError(
            f"VOICE_PROVIDER 配置成了 {PROVIDER!r}，只支持 zhipu / siliconflow。"
        )
    api_key = ZHIPU_API_KEY if cls is ZhipuProvider else SILICONFLOW_API_KEY
    if not api_key:
        raise MissingKeyError(
            f"还没配置 {cls.key_env}：把 .env.example 复制成 .env 并填入 key，然后重启服务。"
        )
    return cls(api_key=api_key, llm_model=LLM_MODEL)
