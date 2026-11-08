@echo off
REM Builds a single WritingAssistant.exe in desktop\dist\
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv || python -m venv .venv
)
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\pyinstaller --noconfirm writing_assistant.spec
echo.
echo Built: %~dp0dist\WritingAssistant.exe
pause
