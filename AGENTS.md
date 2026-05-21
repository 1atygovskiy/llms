# AGENTS.md

## Environment

- **OS:** Windows 10 (win32 10.0.26200)
- **Backend:** Python 3 + aiohttp + SQLite
- **Frontend:** Vue 3 Composition API (`.mjs` modules) + Tailwind CSS

## Setup

```bash
pip install -r requirements.txt
npm install
```

If the page loads blank, install vendored UI libraries (missing from some forks):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-ui-libs.ps1
npx tailwindcss -i ./llms/ui/tailwind.input.css -o ./llms/ui/app.css --minify
```

## Run

```bash
python -m llms
```

Alternative:

```bash
python llms/main.py
```

## Tests

Existing unit tests:

```bash
python -m unittest discover -s tests -p 'test_*.py'
```

Branch tests (pytest + Playwright):

```bash
pip install -r requirements-dev.txt
playwright install chromium
pytest tests/ --headed
```

Or via npm (unittest only):

```bash
npm test
```

## Coding guidelines

- **Python:** PEP 8 style, `ruff` for lint/format, async handlers for I/O, docstrings on public functions
- **Vue/UI:** Composition API in `.mjs` files (inline templates), match existing ServiceStack client patterns
- **API:** Branch routes under `/ext/app/branches/...`; thread persistence in `llms/extensions/app/`
- **Database:** Lazy migration via `ensure_thread_branches()`; dual-write `thread.messages` JSON for default `main` branch only
- **Commits:** Keep changes focused per layer (db, api, ui, tests)
