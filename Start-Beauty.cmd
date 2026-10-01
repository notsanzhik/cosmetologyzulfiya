@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
  ) else (
    echo Install Node.js LTS from https://nodejs.org/ and try again.
    pause
    exit /b 1
  )
)
node "%~dp0Start-Beauty.mjs"
pause
