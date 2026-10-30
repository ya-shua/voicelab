"""VoiceLab 后端入口：python -m uvicorn backend.main:app --port 8787"""
import base64

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx

from backend import llm, voice_library
from backend.config import (
    PROVIDER,
    SILICONFLOW_API_KEY,
    TTS_SPEED,
    TTS_VOICE,
    VOICELAB_TOKEN,
    ZHIPU_API_KEY,
    FRONTEND_DIR,
)
from backend.providers import PROVIDERS, get_provider
from backend.providers.base import MissingKeyError, ProviderError

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 与上游识别接口的上限一致

SYSTEM_PROMPT = (
    "你是 VoiceLab 语音助手。回答要口语化、简洁友好，"
    "一般不超过三句话，适合直接朗读出来。"
)

app = FastAPI(title="VoiceLab", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatIn(BaseModel):
    text: str
    voice: str = ""
    llm: str = ""  # 对话模型预设 id，留空用默认
    speed: float | None = None


class TtsIn(BaseModel):
    text: str
    voice: str = ""
    speed: float | None = None


class LibraryVoiceIn(BaseModel):
    provider: str
    id: str
    name: str
    note: str = ""


async def require_token(request: Request):
    """/v1/* 对外接口的门禁：.env 设置了 VOICELAB_TOKEN 就必须带对。"""
    if not VOICELAB_TOKEN:
        return
    if request.headers.get("authorization", "") != f"Bearer {VOICELAB_TOKEN}":
        raise HTTPException(
            401,
            "token 缺失或不正确：请求头需带 Authorization: Bearer <VOICELAB_TOKEN>（值在服务端 .env 里）",
        )


def audio_b64(audio: bytes) -> str:
    return base64.b64encode(audio).decode()


@app.exception_handler(MissingKeyError)
async def missing_key_handler(_: Request, exc: MissingKeyError):
    return JSONResponse(status_code=400, content={"error": str(exc)})


@app.exception_handler(ProviderError)
async def provider_error_handler(_: Request, exc: ProviderError):
    return JSONResponse(status_code=502, content={"error": str(exc)})


@app.exception_handler(httpx.HTTPError)
async def network_error_handler(_: Request, exc: httpx.HTTPError):
    return JSONResponse(
        status_code=502,
        content={"error": f"访问上游 API 网络失败：{exc.__class__.__name__}。请检查网络后重试。"},
    )


@app.get("/api/health")
async def health():
    key_of = {"zhipu": bool(ZHIPU_API_KEY), "siliconflow": bool(SILICONFLOW_API_KEY)}
    cls = PROVIDERS.get(PROVIDER)
    return {
        "ok": True,
        "provider": PROVIDER,
        "label": cls.label if cls else "未知",
        "capabilities": list(cls.capabilities) if cls else [],
        "key_ready": key_of.get(PROVIDER, False),
    }


@app.get("/api/llms")
async def list_llms():
    return {"llms": llm.list_llms(), "default": llm.pick_default_llm()}


@app.get("/api/voices")
async def list_voices():
    provider = get_provider()
    return [voice.__dict__ for voice in await provider.list_voices()]


@app.post("/api/voices")
async def create_voice(
    file: UploadFile = File(...),
    name: str = Form(...),
    ref_text: str = Form(""),
):
    if not name.strip():
        raise HTTPException(400, "请给音色起个名字。")
    audio = await file.read()
    if not audio:
        raise HTTPException(400, "参考音频是空的。")
    if len(audio) > 10 * 1024 * 1024:
        raise HTTPException(400, "参考音频超过 10MB，请剪短一点（10~20 秒足够）。")
    provider = get_provider()
    voice = await provider.create_voice(
        name.strip(), audio, file.filename or "reference.wav", ref_text.strip()
    )
    return voice.__dict__


@app.post("/api/asr")
async def asr(file: UploadFile = File(...)):
    audio = await file.read()
    if not audio:
        raise HTTPException(400, "录音是空的。")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(400, "音频超过 25MB。")
    provider = get_provider()
    return {"text": await provider.asr(audio, file.filename or "audio.wav")}


@app.post("/api/tts")
async def tts(body: TtsIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "要说的话是空的。")
    provider = get_provider()
    voice = body.voice or TTS_VOICE or provider.default_voice
    audio, mime = await provider.tts(text[:1000], voice, body.speed or TTS_SPEED)
    return {"audio_b64": audio_b64(audio), "audio_mime": mime, "voice": voice}


@app.post("/api/chat")
async def chat(body: ChatIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "说点什么吧，内容是空的。")
    provider = get_provider()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": text[:2000]},
    ]

    # 对话走独立的 LLM 层（可切多家大模型）；一层都没配 key 时退回语音引擎自带的
    llm_id = body.llm.strip() or llm.pick_default_llm()
    if llm_id:
        reply, llm_label = await llm.chat_completion(llm_id, messages)
    else:
        reply, llm_label = await provider.chat(messages), provider.label

    voice = body.voice or TTS_VOICE or provider.default_voice
    audio, mime = await provider.tts(reply, voice, body.speed or TTS_SPEED)
    return {
        "reply_text": reply,
        "audio_b64": audio_b64(audio),
        "audio_mime": mime,
        "voice": voice,
        "llm": llm_label,
    }


@app.get("/api/library/voices")
async def library_list(provider: str = ""):
    return voice_library.list_voices(provider)


@app.post("/api/library/voices")
async def library_upsert(body: LibraryVoiceIn):
    if not (body.provider.strip() and body.id.strip() and body.name.strip()):
        raise HTTPException(400, "provider / id / name 都不能为空。")
    return voice_library.upsert(
        body.provider.strip(), body.id.strip(), body.name.strip(), body.note.strip()
    )


@app.delete("/api/library/voices")
async def library_delete(provider: str, id: str):
    return {"deleted": voice_library.delete(provider, id)}


# ---------- 对外 OpenAI 兼容接口（给酒馆 / QQ 机器人 / Discord 等平台调用） ----------


@app.get("/v1/models", dependencies=[Depends(require_token)])
async def v1_models():
    return {
        "object": "list",
        "data": [{"id": "voicelab", "object": "model", "owned_by": "voicelab"}],
    }


@app.get("/v1/voices", dependencies=[Depends(require_token)])
async def v1_voices():
    """非 OpenAI 标准：列出可用音色（内置 + 音色库），方便平台侧做下拉。"""
    provider = get_provider()
    builtins = [v.id for v in await provider.list_voices()]
    lib = voice_library.list_voices(PROVIDER)
    return {
        "voices": builtins + [v["name"] for v in lib],
        "library": lib,
    }


@app.post("/v1/audio/speech", dependencies=[Depends(require_token)])
async def v1_speech(request: Request):
    """OpenAI 兼容 TTS：input + voice（音色库里的名字或 id，或内置音色）。"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "请求体不是 JSON。")
    text = (body.get("input") or "").strip()
    if not text:
        raise HTTPException(400, "input 是空的。")
    voice = (body.get("voice") or "").strip()
    try:
        speed = float(body.get("speed") or 1.0)
    except (TypeError, ValueError):
        speed = 1.0

    provider = get_provider()
    voice_id = voice_library.resolve(voice, PROVIDER) or provider.default_voice
    audio, mime = await provider.tts(text[:2000], voice_id, speed)
    # response_format 由当前引擎决定（智谱=wav，硅基流动=mp3），如实返回
    return Response(content=audio, media_type=mime)


# 静态前端放在最后挂载，/api/* 与 /v1/* 优先
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
