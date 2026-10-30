"""音色库：克隆音色的服务端档案（data/voices.json）。

音色档案 = {provider, id, name, note, created_at}
这是"给别的 AI 配置音色"的数据基础：聊天平台/酒馆用名字或 id 引用这里的条目，
网页前端克隆成功后自动入库，浏览器之间也共享同一份。
"""
import json
import time

from backend.config import BASE_DIR

LIB_PATH = BASE_DIR / "data" / "voices.json"


def _load() -> list[dict]:
    if not LIB_PATH.exists():
        return []
    try:
        return json.loads(LIB_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    LIB_PATH.parent.mkdir(parents=True, exist_ok=True)
    LIB_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def list_voices(provider: str = "") -> list[dict]:
    items = _load()
    if provider:
        items = [v for v in items if v.get("provider") == provider]
    return items


def upsert(provider: str, voice_id: str, name: str, note: str = "") -> dict:
    items = _load()
    for v in items:
        if v.get("provider") == provider and v.get("id") == voice_id:
            v["name"] = name
            v["note"] = note
            _save(items)
            return v
    entry = {
        "provider": provider,
        "id": voice_id,
        "name": name,
        "note": note,
        "created_at": int(time.time()),
    }
    items.append(entry)
    _save(items)
    return entry


def delete(provider: str, voice_id: str) -> bool:
    """只删档案记录，不删云端的音色本体。"""
    items = _load()
    kept = [
        v for v in items
        if not (v.get("provider") == provider and v.get("id") == voice_id)
    ]
    if len(kept) == len(items):
        return False
    _save(kept)
    return True


def resolve(voice: str, provider: str = "") -> str:
    """把"音色名或 id"解析成可用的 voice id；找不到就原样返回（内置音色直传引擎）。"""
    if not voice:
        return voice
    items = _load()
    for v in items:  # 精确 id 优先
        if v.get("id") == voice:
            return v["id"]
    for v in items:  # 再按名字找，同引擎优先
        if v.get("name") == voice and (not provider or v.get("provider") == provider):
            return v["id"]
    return voice
