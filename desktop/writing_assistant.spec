# PyInstaller spec:  pyinstaller writing_assistant.spec   ->  dist/WritingAssistant(.exe)
import sys
block_cipher = None

a = Analysis(
    ["wa_desktop/__main__.py"],
    pathex=["."],
    datas=[("../shared/prompt.json", "shared"), ("assets/icon.png", "assets")],
    hiddenimports=["pynput.keyboard._win32", "pynput.mouse._win32",
                   "pynput.keyboard._darwin", "pynput.mouse._darwin",
                   "pynput.keyboard._xorg", "pynput.mouse._xorg"],
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, a.binaries, a.zipfiles, a.datas, [],
    name="WritingAssistant",
    console=False,
    icon="assets/icon.png",  # PyInstaller converts this to .ico/.icns using Pillow
    upx=False,
)
if sys.platform == "darwin":
    app = BUNDLE(exe, name="WritingAssistant.app", icon=None, bundle_identifier="local.writing-assistant",
                 info_plist={"LSUIElement": True})
