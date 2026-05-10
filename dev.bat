@echo off
start "Vite Dev Server" cmd /k "cd /d "%~dp0frontend" && npm run dev"
start "FastAPI Backend" cmd /k "cd /d "%~dp0" && uvicorn backend.main:app --reload"
