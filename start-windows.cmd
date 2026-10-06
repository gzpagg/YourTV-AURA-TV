@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
echo Keep this window open while using AURA TV. Press Ctrl+C to stop.
call npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --open
exit /b %errorlevel%
:failed
echo Setup failed. Please review the error above.
pause
exit /b 1
