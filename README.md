# Write.JS
A rich-text notebook in the browser: documents in folders, tabs and split editors, vi keybindings, checklists, tables, comments, scripts and scheduled scripts (cron), offline use and cloud sync for logged in users.
The backend is [FastAPI](https://fastapi.tiangolo.com/) with authorization and localizations.

### Table of contents
1. Features
2. About Project
3. Environment Setup
4. Testing

# Features
## Workspace
- **File Explorer**: a tree of documents and folders (sub-folders nest up to a set depth). It can be docked left, right, top or bottom by drag-and-drop or from its right-click menu, and resized
- folders can get a **color**, which also tints their sub-folders and the tabs of their documents
- several documents can be selected with Ctrl/Cmd+click and Shift+click, then opened, moved, dragged or deleted together
- **Duplicate** a document (tree or tab menu) as `name (copy)`, unsaved edits included
- double click a document to **reveal it in the tree**
- **Tabs** for opened documents, docked on the top or the bottom; the tab tooltip shows the document's path
- **Split view**: up to 4 editor panes
- every document remembers its **scroll position and caret**, across visits once saved
- **Open in New Window**: a document in a browser tab of its own (always in focus mode, with its own table of contents, search and export menu)
- **Focus mode**: only the text and the word count, for the focused document or for every opened tab
- **Document title**: a document can show its name as a title above the text (line 0); editing it renames the document
- layout, opened tabs and split editors are kept as preferences

## Editor
- formatting toolbar: text, Heading 1-4, horizontal rule, inline code, code block, table, link, soft return, tab
- **Auto detect** (Settings > Auto detect): Markdown typed into the editor turns into formatting
  - line start: `* ` bullets, `1. ` numbers, `- [ ]` / `- [x]` checklist items, `---` rule, `#`-`####` headings
  - inline: `**bold**`, `*italic*` / `_italic_`, `__underline__`, `` `code` ``
  - ` ``` ` + Enter opens and closes a code block
  - each rule can be turned off; Ctrl/Cmd+Z reverts a conversion
- **Line numbers** (Settings > Editor or vi `:lines`): click a number to select its line, Shift+click or drag to select a range
- **Search in Document** (Ctrl/Cmd+F): live highlighting, Enter / Shift+Enter to go through matches, case sensitivity toggle; opens collapsed sections that hold a match
- **Copy button** on code blocks
- spell check and autosave can be turned on and off
- word counter

## Checklists and lists
- checklist items are items of bulleted lists, so a list can mix bullets and checkboxes; click the box or press Ctrl/Cmd+Enter to toggle
- Tab / Shift+Tab nests and un-nests items
- a parent item can be **checked automatically** when all its nested items are (Settings > Lists)
- copying checklist items gives Markdown (`- [ ] a`, `- [x] a`); pasting Markdown checklists or text lines into a list makes items
- Cmd+Ctrl+Up/Down (or k/j) moves items up and down

## Folding
- **headings** collapse the lines under them, up to the next heading of the same or higher level
- **lists** (bulleted, numbered, checklists) collapse their nested items
- both can be turned off in Settings > Headings / Lists
- Settings > Save folding state decides whether folds are saved in the document and whether Contents folds are kept on this device

## Table of Contents
- the headings of the focused document; a click scrolls to a heading and the heading being read is marked
- shown as a tab next to the tree, as its own panel (left, right, top, bottom) or split with the tree; moved by drag-and-drop
- heading levels to list are picked in Settings; top-level checklist items can be listed too
- entries can be folded independently of the document; keyboard navigation with arrows or j/k, Enter, Esc, left/right

## Tables
- insert from the toolbar (columns, rows, header row), edit from a cell's right-click menu (add/remove rows and columns, remove the table)
- Tab / Shift+Tab moves between cells, Tab in the last cell adds a row
- spreadsheet-like cell selection (drag, Shift+click, Shift+arrows, Ctrl/Cmd+click)
- copying cells gives Markdown or HTML text (Settings > Tables); HTML and Markdown tables can be pasted
- rows can be moved with Cmd+Ctrl+Up/Down

## Links between documents
- every document has a hidden unique id, so **Insert Link > Write.JS doc** keeps working after the target is renamed or moved
- a click opens the linked document, Ctrl/middle click opens it in a new browser tab
- internal links are removed from exports

## Comments
- hover a line and click the `+` on its right to comment it
- a line with comments gets an icon in the margin: red while any comment is unresolved, green when all are resolved
- comments are saved and synced with the document

## Scripting
- a document with scripts enabled (document menu) gets a **Script** button in the toolbar
- the Script wizard adds a script button to the text: display name, border and JavaScript code (async, `await` works)
- the code gets `scope` (its own variables), `editor` (the document's element) and helper functions from `static/scriptapi.js`; the wizard's help lists them
- a right click on a line's `+` gives it an element id for scripts to use
- script changes can be undone/redone (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y, vi `u` / `Ctrl+r`)
- scripts can't use `localStorage` / `sessionStorage`; this is a guard, not a sandbox
- scripts are left out of exports
- notebook level functions work on the whole notebook, e.g. `duplicateDocument({directory: "Daily", index: -1})` duplicates the last document (by name) of the folder `Daily`
  - `directory`: a folder's path (`Work/Daily`, a folder's path is its id) or name, `""` for documents outside of folders, `null` for all
  - `doc`: a document's name or id, `index`: `0, 1, 2, ...` or `-1` (last), `-2` (second last), ...; fails when nothing or several documents match
- `createNotification(text, type, timeout, timestamp=false)`: with `timestamp` the heading gets the time, `HH:MM:SS dd-mm-YYYY`

## Notebook Cron
- turned on in Settings > Notebook cron; off, nothing is fetched or run, and the jobs stay as they are
- menu > **Notebook Cron** lists the jobs, add/remove them, each with: document, script (the display name of a script button in it), cron, executor (*Set this browser*), *Run*, next execution and *Enabled*; below them the log of the last 100 runs
- a job runs only in its executor browser, while the app is open there (one tab runs them); the document doesn't have to be opened, what the script changes is saved with it
- cron: `minute hour day month weekday`, with `*`, numbers, ranges `1-5`, lists `1,3` and steps `*/15`
- `_` runs once in the period if not yet executed, whenever the app is open: `_ * * * *` every hour, `_ _ * * *` every day, `_ _ * * 2` on Tuesdays (whether the app is opened at 7 or at 11), `_ _ _ * *` every month
- a job that should have run while the app was closed gets a `!` until it runs again, and the executor shows one notification *You have missed some cron jobs* that opens the jobs
- logged in, the jobs and the log are kept in the cloud (tables `notebook_crons`, `notebook_cron_log`), otherwise in the browser

## Vi mode
Settings > Vi mode turns on vi keybindings modeled on Neovim / VSCodeVim:
- NORMAL, INSERT, VISUAL, V-LINE and REPLACE modes, with the mode shown top right
- motions (`h j k l w b e 0 ^ $ gg G { } % f t ; ,` ...), `]m` / `[m` to jump between headings, counts, operators (`d c y > <`), `.` repeat, `/` `?` `n` `N` `*` `#` search
- word-wrap navigation (j/k follow wrapped lines), can be turned off
- panels: `Ctrl+w` to move between split editors and the tree, `gt` / `gT` for tabs
- ex commands: `:w`, `:wa`, `:q`, `:qa`, `:wq`, `:e`, `:sp` / `:vs`, `:tree`, `:toc`, `:table`, `:script`, `:focus`, `:lines`, `:noh`, `:help`, `:{range}d` / `:{range}y`, `:12` to go to a line; commands are completed after one character
- the File Explorer and the Script wizard's code editor work with vi too
- optional Esc button on mobiles

## Import and export
- import HTML or Markdown documents, insert or append HTML / Markdown into a document
- export as Markdown, copy as Markdown, export as HTML or PDF
- export / import the whole notebook to a file (pako-compressed)

## Mobile
- the tree and the Table of Contents are a drawer, which can be pinned and resized
- tap and hold for context menus, touch friendly checklists

## Offline and storage
- documents are stored in `localStorage`; the app can be installed (PWA) and used offline (service worker, `static/sw.js`)
- usage monitor and storage consent

## Themes
- styling comes from [milessic-themes](http://mbs.local:9312/) when ``MILESSIC-THEMES`` is set, otherwise the bundled Write.js theme (`static/themes/writejs.css`) is used

# About project
## Project Structure
```
.
├── routers
├── scripts
├── static          (the web app: index.html, script.js, workspace.js, vi.js, ... one file per feature)
│   ├── legal
│   └── themes
├── templates/
│   └── mailing
├── tests
│   └── e2e
└── utils/
    ├── auth
    ├── db
    ├── docs
    ├── localizations
    ├── mailing
    ├── templates
    └── zlib_util
```

## Authorization
- project uses jwt access tokens + refresh tokens that are also stored in Database


## Notebooks and cloud sync
- every user has a ``Default`` notebook (``routers/notebooks.py``, tables ``user_notebooks`` and ``notebook_documents``); it is not shown in the UI yet
- each document is its own row, known by the uuid the client keeps in it, with its name, its pako-compressed content and a version; deleted documents stay as tombstones
- the folders and the settings are the notebook's ``meta``, versioned the same way
- every write carries the version the client last saw, a stale one gets ``409`` and the client shows the conflict resolver
- the client (``static/cloudsync.js``) auto-syncs 5 s after the last save, at most once a minute; *Settings > Cloud sync* shows each document's status and has *Resync*
- a notebook stored as a whole before (``/api/notebooks/notebook``) is moved to documents by the first device that syncs
- the Notebook Cron jobs and their log are kept apart, in ``notebook_crons`` and ``notebook_cron_log`` (``/api/notebooks/{id}/crons``), they don't sync with the documents


## Localizations
- Translation files are stored as ``json`` files under ``utils/localizations/translations/``
- to create new empty translation file, run ``utils/localizations/generate_new_translation_file.py``
- to test your translation configuration, run test ``tests/test_localizations.py``
- no need to reload server after update on existing ``json`` file, there is an observer that reloads translations when it detects changes in ``*.json`` files under translations directory


# Environment setup
1. install python3
2. create venv
3. install ``requirements.txt``
4. create ``.env`` file:
```
HOST= host, e.g. localhost:8000

SECRET_KEY= secure secret
ALGORITHM=HS256 or any other
ACCESS_TOKEN_EXPIRES_MINUTES=30
REFRESH_TOKEN_EXPIRES_MINUTES=1200

FORGOTTEN_PASSWORD_EXPIRES_MINUTES=60
MAX_LOGIN_ATTEMPTS=5

MAILING_ACCOUNT_EMAIL= your-smtp@mail.com
MAILING_ACCOUNT_PASSWORD= pasword to mail that will be used for SMTP
MAILING_SMTP_SERVER= smtp server
MAILING_SMTP_PORT= smtp port
MAILING_SMTP_TIMEOUT= smtp timeout

SWAGGER_URL=/docs or comment to disable
REDOC_URL=/redoc or comment to disable
OPENAPI_URL=/openapi.json or comment to disable

PASSWORD_MIN_LEN=7
PASSWORD_MAX_LEN=32

MILESSIC-THEMES= milessic-themes server url, e.g. http://mbs.local:9312/ (optional, falls back to the bundled Write.js theme)
```
5. run as uvicorn ``python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8990``, you can change host or port for your needs


# Testing
### Unit tests
You can run tests with [pytest](https://docs.pytest.org/en/stable/) - ``python3 -m pytest -v``

### Browser tests
``tests/e2e`` drive the app in Chromium with [Playwright](https://playwright.dev/python/) (vi mode), they start the server themselves:
```
pip install -r requirements-dev.txt && playwright install chromium
python3 -m pytest tests/e2e -v
```

### Web app
The Write.JS app (with register/login/logout) is served on the ``/`` endpoint. Just go to ``http://localhost:8990`` after following steps described under __Environment setup__ and you will be able to test all functionalities.

### Swagger
There is also the ``Swagger`` interface located under ``/docs`` endpoint

### CLI register/login
To test the login/register/token functionalities you can do it via web application, accessible from ``localhost:port`` leveraging browser authentication functionality (via auth cookie) or via REST calls, you can use scripts placed under ``./scripts/`` directory, e.g. ``./scripts/register_user_via_rest.py/`` that use ``requests`` library (which is not included in ``requirements.txt`` file.

