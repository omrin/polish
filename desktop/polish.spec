# PyInstaller spec for Polish.
#   pyinstaller --noconfirm polish.spec
# Windows/Linux -> dist/Polish/ (folder; the Windows installer packs it)
# macOS        -> dist/Polish.app
import sys

block_cipher = None
IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform.startswith("win")

a = Analysis(
    ["polish_main.py"],
    pathex=["."],
    datas=[("../shared/prompt.json", "shared"),
           ("assets/icon.png", "assets"), ("assets/icon_32.png", "assets"), ("assets/icon_16.png", "assets")],
    hiddenimports=["pynput.keyboard._win32", "pynput.mouse._win32",
                   "pynput.keyboard._darwin", "pynput.mouse._darwin",
                   "pynput.keyboard._xorg", "pynput.mouse._xorg"],
    # Qt modules Polish never uses; keeps the download smaller.
    excludes=["PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets", "PySide6.QtQml", "PySide6.QtQuick",
              "PySide6.Qt3DCore", "PySide6.QtMultimedia", "PySide6.QtCharts", "PySide6.QtDataVisualization",
              "PySide6.QtPdf", "PySide6.QtSql", "PySide6.QtTest", "tkinter"],
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="Polish",
    console=False,
    icon="../installer/windows/polish.ico" if IS_WIN else "assets/icon.png",
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, name="Polish", upx=False)
if IS_MAC:
    app = BUNDLE(
        coll, name="Polish.app", icon="assets/icon.png", bundle_identifier="io.github.omrin.polish",
        info_plist={"LSUIElement": True, "CFBundleShortVersionString": "1.0.0",
                    "NSHumanReadableCopyright": "Apache License 2.0"},
    )
