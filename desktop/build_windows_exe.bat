@echo off
REM Builds Polish for Windows: desktop\dist\Polish\Polish.exe, and Polish-Setup.exe if NSIS is installed.
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv || python -m venv .venv
)
.venv\Scripts\python -m pip install -r requirements.txt -r requirements-dev.txt
.venv\Scripts\pyinstaller --noconfirm polish.spec || goto :eof
set MAKENSIS="%ProgramFiles(x86)%\NSIS\makensis.exe"
if exist %MAKENSIS% (
  %MAKENSIS% /DSRCDIR="%~dp0dist\Polish" /DOUTFILE="%~dp0dist\Polish-Setup.exe" ..\installer\windows\polish.nsi
  echo.
  echo Built: %~dp0dist\Polish-Setup.exe
) else (
  echo.
  echo Built: %~dp0dist\Polish\Polish.exe
  echo Install NSIS from https://nsis.sourceforge.io to also build Polish-Setup.exe
)
pause
