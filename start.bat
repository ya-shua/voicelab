@echo off
chcp 65001 >nul
cd /d %~dp0

if not exist .venv (
  echo [VoiceLab] 首次运行，正在创建虚拟环境并安装依赖…
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt -q
)

if not exist .env (
  echo [VoiceLab] 还没有 .env 文件，已为你复制模板。请填入 API Key 后重新运行。
  copy .env.example .env >nul
  notepad .env
  exit /b
)

echo [VoiceLab] 启动中… 浏览器打开 http://127.0.0.1:8787
timeout /t 2 >nul
start "" http://127.0.0.1:8787
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8787
