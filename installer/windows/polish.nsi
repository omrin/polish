; Polish - Windows installer (NSIS 3).
; Per-user install like Grammarly: no administrator rights needed.
;
; Build (after PyInstaller has produced desktop\dist\Polish\):
;   makensis /DVERSION=1.0.0 /DSRCDIR=<path to desktop\dist\Polish> /DOUTFILE=<path to Polish-Setup.exe> polish.nsi

Unicode true
!include "MUI2.nsh"

!define APPNAME "Polish"
!define PUBLISHER "Polish"
!define WEBSITE "https://github.com/omrin/polish"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Polish"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef SRCDIR
  !define SRCDIR "..\..\desktop\dist\Polish"
!endif
!ifndef OUTFILE
  !define OUTFILE "Polish-Setup.exe"
!endif

Name "${APPNAME}"
Caption "${APPNAME} ${VERSION} Setup"
BrandingText "${APPNAME} - Make it shine."
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Polish"
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Apache License 2.0"

!define MUI_ICON "polish.ico"
!define MUI_UNICON "polish.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Polish"
!define MUI_WELCOMEPAGE_TEXT "Polish fixes grammar and spelling and suggests better phrasing in any app, with one keystroke.$\r$\n$\r$\nSelect text anywhere and press Ctrl+Alt+G to fix it, or Ctrl+Alt+R to rephrase it.$\r$\n$\r$\nClick Next to continue."
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\Polish.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Polish now"
!define MUI_FINISHPAGE_LINK "Polish on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${WEBSITE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Polish" SecMain
  SectionIn RO
  ; Close a running copy so its files can be replaced (upgrade in place).
  nsExec::Exec 'taskkill /IM Polish.exe /F'
  Sleep 500
  RMDir /r "$INSTDIR\_internal"
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Polish.exe"
  CreateShortCut "$SMPROGRAMS\Polish.lnk" "$INSTDIR\Polish.exe" "" "$INSTDIR\Polish.exe" 0

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "${WEBSITE}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\Polish.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall Polish.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall Polish.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Start Polish when Windows starts" SecAutostart
  WriteRegStr HKCU "${RUNKEY}" "Polish" '"$INSTDIR\Polish.exe"'
SectionEnd

Section /o "Desktop shortcut" SecDesktop
  CreateShortCut "$DESKTOP\Polish.lnk" "$INSTDIR\Polish.exe" "" "$INSTDIR\Polish.exe" 0
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Polish.exe /F'
  Sleep 500
  RMDir /r "$INSTDIR\_internal"
  Delete "$INSTDIR\Polish.exe"
  Delete "$INSTDIR\Uninstall Polish.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Polish.lnk"
  Delete "$DESKTOP\Polish.lnk"
  DeleteRegValue HKCU "${RUNKEY}" "Polish"
  DeleteRegKey HKCU "${UNINSTKEY}"
  ; Settings in %APPDATA%\Polish (API key, hotkeys) are kept for a future reinstall.
SectionEnd
