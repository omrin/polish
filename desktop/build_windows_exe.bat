@echo off
REM Builds a single Polish.exe in desktop\dist\
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv || python -m venv .venv
)
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\pyinstaller --noconfirm polish.spec
echo.
echo Built: %~dp0dist\Polish.exe
pause
