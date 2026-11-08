"""Entry point for the packaged app (PyInstaller needs an absolute-import script)."""
from wa_desktop.app import main

if __name__ == "__main__":
    raise SystemExit(main())
