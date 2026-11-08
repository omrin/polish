# Polish website

- `page.html` is the page content (the version published as a Claude artifact).
- `index.html` is the same content wrapped in a full HTML document for GitHub Pages. Regenerate it after editing `page.html`:

  ```bash
  python3 website/build.py
  ```

GitHub Pages deploys this folder automatically (`.github/workflows/pages.yml`) once Pages is enabled:
repo **Settings → Pages → Source: GitHub Actions**. The site is then at https://omrin.github.io/polish/
