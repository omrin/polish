<p align="center"><img src="shared/brand/icon-512.png" width="112" alt="Polish icon"></p>

<h1 align="center">Polish</h1>
<p align="center"><i>Make it shine.</i></p>
<p align="center"><a href="https://omrin.github.io/polish/">Website</a> · <a href="https://github.com/omrin/polish/releases/latest">Download</a></p>

Polish is a Grammarly-style writing assistant powered by Claude. At the push of a button it:

- **fixes grammar, spelling and punctuation**, showing each change with a short explanation, and
- **suggests other phrasings**: Formal, Concise and Friendly by default; you can change these.

It runs in two places, and both use the same prompt and the same response format:

| | Where it works | How to trigger it |
|---|---|---|
| **Desktop app** (`desktop/`) | Any application: Word, Outlook, Teams, Notepad, browsers, EMR forms… | Select text, then press a global hotkey |
| **Chrome extension** (`extension/`) | Any text box, input or rich-text editor on any website (Gmail, web forms, chats…) | Click the floating **P** button, use a keyboard shortcut, or right-click |

It handles English and Hebrew. Hebrew text stays in Hebrew, and the UI switches to right-to-left on its own.

There are two ways to use it:

- **A Polish account (default):** sign in with an email code or Google. New accounts get 75 free credits, and you buy more on the website, from $5. No API key needed.
- **Your own Anthropic API key (advanced):** Polish talks to Anthropic directly, and no account or credits are involved.

Running the paid service yourself (server, payments, sign-in) is covered in **[docs/OPERATOR.md](docs/OPERATOR.md)**.

## Download

| | |
|---|---|
| **Windows 10/11** | [Polish-Setup.exe](https://github.com/omrin/polish/releases/latest/download/Polish-Setup.exe). Run it; no administrator rights are needed |
| **macOS 12+** | [Polish-macOS.dmg](https://github.com/omrin/polish/releases/latest/download/Polish-macOS.dmg). Drag Polish to Applications |
| **Chrome / Edge** | [Polish-Chrome-Extension.zip](https://github.com/omrin/polish/releases/latest/download/Polish-Chrome-Extension.zip). Unzip it, then follow step 3 below |

All versions: [Releases](https://github.com/omrin/polish/releases). The apps aren't code-signed yet. On Windows, if SmartScreen appears, click **More info → Run anyway**. On macOS, right-click Polish.app and choose **Open** the first time.

---

## ⚠️ Privacy first

**Any text you check is sent to Claude (Anthropic) over HTTPS.** With a Polish account it passes through the
Polish service, which doesn't store it. Don't use this on patient-identifiable or other confidential information
unless your organization's policy allows it. With an account, the desktop app keeps its sign-in in the OS keychain.
In own-key mode, the API key is stored in plain text on your machine: in `%APPDATA%\Polish\config.json` for the
desktop app, and in the browser profile for the extension.

---

## 1. Sign in (or get an API key)

When Polish starts, click **Sign in** and approve in your browser. That's all.

For own-key mode instead, create a key at <https://console.anthropic.com/> under **API Keys**. Then choose
**My own Anthropic API key** in Settings (desktop) or Options (extension).

## 2. Desktop app (works anywhere)

### Windows

The easiest way is the installer under **Download** above. To run from source instead:

1. Install Python 3.10+ from <https://www.python.org/downloads/>. During setup, tick **"Add python.exe to PATH"**.
2. Double-click **`desktop\run_windows.bat`**. The first run installs dependencies, which takes about a minute.
3. The blue **P** icon appears in the system tray, and the Settings window opens. Paste your API key there.

To build the installer yourself, run `desktop\build_windows_exe.bat`. It produces `desktop\dist\Polish-Setup.exe`
if [NSIS](https://nsis.sourceforge.io) is installed. Releases are built automatically by GitHub Actions
(`.github/workflows/release.yml`): change the number in `VERSION` and push to `main`.

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
3. Click into any text box. A small **P ✎** button appears in its corner:
   - **P**: fix grammar & spelling. **✎**: rephrase.
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
shared/brand/             logo: icon.svg (master), icon-small.svg (tuned for 16–32 px), icon-512.png
server/                   Polish service: Cloudflare Worker + D1 (sign-in, credits, Paddle, Claude proxy)
website/                  landing page (page.html) and the pages the Worker serves (public/)
docs/OPERATOR.md          how to run the paid service: accounts, keys, deploy, smoke test
shared/prompt.json        single source of truth: system prompt, JSON schema, limits, defaults
scripts/sync_shared.py    regenerates extension/src/shared.js from shared/prompt.json
desktop/wa_core/          pure logic: prompt, Claude API call, response validation, word diff, config
desktop/wa_desktop/       tray app: global hotkeys (pynput), clipboard/selection, Qt popup + settings
extension/src/            MV3 extension: background worker (API), content script, Shadow-DOM card, options
```

After you edit `shared/prompt.json`, run `python scripts/sync_shared.py`. A test fails if you forget.

## 6. Tests

```bash
cd desktop && pip install -r requirements.txt -r requirements-dev.txt && python -m pytest   # 110 tests
cd extension && npm install && npx playwright install chromium && npm test                 # 20 unit + 13 end-to-end
cd server && npm ci --legacy-peer-deps && npm test                                         # 55 service tests (workerd + local D1)
NODE_PATH=extension/node_modules node --test website/tests/website.spec.js                 # 5 website tests (wrangler dev)
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

## License

Apache License 2.0. See [LICENSE](LICENSE).
