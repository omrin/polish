# Writing Assistant

A Grammarly-style writing assistant powered by Claude. At the push of a button it:

- **fixes grammar, spelling and punctuation**, showing each change with a short explanation, and
- **suggests other phrasings**: Formal, Concise and Friendly by default; you can change these.

It runs in two places, and both use the same prompt and the same response format:

| | Where it works | How to trigger it |
|---|---|---|
| **Desktop app** (`desktop/`) | Any application: Word, Outlook, Teams, Notepad, browsers, EMR forms… | Select text, then press a global hotkey |
| **Chrome extension** (`extension/`) | Any text box, input or rich-text editor on any website (Gmail, web forms, chats…) | Click the floating **W** button, use a keyboard shortcut, or right-click |

It handles English and Hebrew. Hebrew text stays in Hebrew, and the UI switches to right-to-left on its own.

---

## ⚠️ Privacy first

**Any text you check is sent to Anthropic's API (Claude) over HTTPS.** Don't use this on
patient-identifiable or other confidential information unless your organization's policy allows it
(for example, under an agreement with Anthropic). The API key is stored in plain text on your machine:
in `%APPDATA%\WritingAssistant\config.json` for the desktop app, and in the browser profile for the extension.

---

## 1. Get an API key

Create a key at <https://console.anthropic.com/> under **API Keys**. Both apps ask for it on first run.

## 2. Desktop app (works anywhere)

### Windows

1. Install Python 3.10+ from <https://www.python.org/downloads/>. During setup, tick **"Add python.exe to PATH"**.
2. Double-click **`desktop\run_windows.bat`**. The first run installs dependencies, which takes about a minute.
3. A green **W** icon appears in the system tray, and the Settings window opens. Paste your API key there.

To get a single **`WritingAssistant.exe`** you can share or copy to other PCs without Python, run
`desktop\build_windows_exe.bat`. The output is `desktop\dist\WritingAssistant.exe`.
To start it with Windows, put a shortcut to it in `shell:startup`.

### macOS / Linux

```bash
./desktop/run_mac_linux.sh
```

- **macOS:** on first use, allow the app (Terminal/Python) under *System Settings → Privacy & Security* → **Accessibility** and **Input Monitoring**.
- **Linux:** this needs an X11 session and `xclip` (`sudo apt install xclip`). Wayland can't do global hotkeys or simulated typing.

### Using it

Select text in any app and press a hotkey:

| Hotkey | Action |
|---|---|
| **Ctrl + Alt + G** | Fix grammar & spelling. A popup shows the changes; **Replace** (or Enter) puts the corrected text in |
| **Ctrl + Alt + Shift + G** | Fix and replace right away, with no popup. Ctrl+Z undoes it in the app |
| **Ctrl + Alt + R** | Rephrase. You get the corrections plus 3 alternative versions; pick one and click **Replace** |

You can change the hotkeys in *Settings*. The tray menu also has **Check clipboard text**, **Fast mode**
(uses a cheaper, quicker model) and **Settings**.

How it works: the hotkey simulates **Ctrl+C** to read your selection, sends it to Claude, shows the result,
and pastes the version you choose with **Ctrl+V**. Your clipboard is put back the way it was afterwards.

## 3. Chrome extension

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/` folder.
2. The Options page opens. Paste your API key, click **Save**, then **Test key**.
3. Click into any text box. A small **W ✎** button appears in its corner:
   - **W**: fix grammar & spelling. **✎**: rephrase.
   - Keyboard: **Alt+Shift+G** fixes, **Alt+Shift+R** rephrases. You can change these at `chrome://extensions/shortcuts`.
   - Right-click in a text box: **Fix grammar & spelling** / **Rephrase…**
4. If you select part of the text, only that part is checked. Otherwise the whole field is.
   **Apply** puts the change in, and Ctrl+Z undoes it.

The extension doesn't work in Google Docs, which doesn't use normal text fields. Use the desktop app there.

## 4. Models and cost

| Setting | Default | Notes |
|---|---|---|
| Model | `claude-opus-5-5` | Best quality. Runs at *low effort* so responses come back fast |
| Fast-mode model | `claude-haiku-5-5` | Much cheaper and quicker. Turn it on from the tray menu or Options |

Checking a typical paragraph costs a fraction of a cent. You can enter any Claude model ID in Settings/Options,
for example `claude-sonnet-5-5`.

**Refusal fallback (on by default):** if Claude's safety filters decline a request (for example,
medical wording mistaken for something harmful), the API retries it on a fallback model in the same call.
This uses the `server-side-fallback-2026-07-01` beta. It only applies to Opus, Sonnet and Fable models,
and you can turn it off in Settings/Options.

## 5. Project layout

```
shared/prompt.json        single source of truth: system prompt, JSON schema, limits, defaults
scripts/sync_shared.py    regenerates extension/src/shared.js from shared/prompt.json
desktop/wa_core/          pure logic: prompt, Claude API call, response validation, word diff, config
desktop/wa_desktop/       tray app: global hotkeys (pynput), clipboard/selection, Qt popup + settings
extension/src/            MV3 extension: background worker (API), content script, Shadow-DOM card, options
```

After you edit `shared/prompt.json`, run `python scripts/sync_shared.py`. A test fails if you forget.

## 6. Tests

```bash
cd desktop && pip install -r requirements.txt -r requirements-dev.txt && python -m pytest   # 59 tests
cd extension && npm install && npx playwright install chromium && npm test                 # 11 unit + 8 end-to-end
```

The end-to-end tests load the real extension in headless Chromium and run it against a local mock of the Claude API,
so they need no API key. They cover the textarea, text input with a partial selection, contenteditable,
rephrase via the command path, Hebrew RTL, a missing key, a bad key, and Escape.

## 7. Known limitations

- **It needs an internet connection.** The checking is done by Claude in Anthropic's cloud, so nothing works offline.
  You also need to reach `api.anthropic.com`; if a hospital firewall or proxy blocks it, you'll see "Can't reach the Anthropic API".
- **Windows:** the desktop app can't paste into programs running *as Administrator* unless it also runs as Administrator. This is a Windows security restriction.
- Clipboard restore keeps text only. If an image was on the clipboard, it's lost after a check.
- Selections are limited to 8,000 characters by default. You can change this in Settings.
- The extension doesn't run on `chrome://` pages, the Chrome Web Store, or Google Docs.
