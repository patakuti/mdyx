# MDyX

A LyX-style WYSIWYM Markdown editor.

MDyX lets you edit plain Markdown files with a WYSIWYM ("What You See Is What You Mean") interface in the spirit of [LyX](https://www.lyx.org/): an always-visible menu bar and formatting toolbar instead of raw Markdown syntax, while the file on disk stays plain, portable Markdown that any other editor or tool can open.

![A table, a math formula, and a PlantUML diagram, all edited visually in one MDyX document](samples/sample-document.png)

## Why MDyX?

- Good WYSIWYG-style Markdown editors turned out to be surprisingly hard to find.
- Markdown is great, but you shouldn't have to learn its syntax to get the benefit of it — the same way LyX lets you write LaTeX documents without writing LaTeX by hand.
- Complex tables and diagrams are best edited in a dedicated tool, not reinvented inside a text editor. MDyX leaves that work to external tools (a spreadsheet, a PlantUML editor, ...) and exchanges data with them through the clipboard, in both directions.

## Features

- Tabbed editing of multiple Markdown files, with your open tabs and window layout restored the next time you launch the app.
- Single-instance: launching MDyX while it's already running (e.g. `mdyx some-file.md` from a terminal) opens that file as a new tab in the existing window instead of starting a second copy — see [Command line](#command-line) below.
- Tables with merged cells and math formulas, edited directly in place, plus PlantUML/Mermaid diagrams rendered inline from their source — no more toggling between raw Markdown and a preview pane.
- Everything round-trips through the clipboard: copy a table into a spreadsheet and back, and it's still a table. Same for diagrams and images. Hover over (or select) an image/PlantUML/Mermaid node to see a small badge identifying what it is, and copying one shows a toast confirming exactly what was written to the clipboard.
- `Ctrl+Wheel` zooms the whole document in/out (50%–200%), text/tables/math/diagrams alike — see [Zoom](#zoom) below.
- Images are always referenced by path or URL, never embedded as binary data.
- The saved file is plain, ordinary Markdown, readable by any other tool.
- Export to a styled, standalone HTML file (or straight to PDF via your browser's Print dialog), with a theme you can customize — see [Export](#export) below for details.

## Usage

### Tables

- **Insert**: paste a table (from a spreadsheet, or Markdown pipe syntax) with nothing selected, or use Insert > Table.
- **Update**: select the table and paste a new one to replace it in place.
- **External tools**: copying a selected table writes both an HTML and a Markdown version to the clipboard, so it pastes back correctly into a spreadsheet app too — merged cells included.

![Copying a table from LibreOffice Calc into MDyX, then copying it back out again](samples/demo1.gif)

### Images

- **Insert**: paste a file path or URL with nothing selected, or use Insert > Image (opens a dialog to type a path/URL or browse for a file, if the clipboard doesn't have a usable one).
- **Update**: select the image and paste a new path/URL to replace it.
- **External tools**: copying a selected image gives you back its file path, to hand off to another program.
- **Select the image itself** (click directly on it) before copying. Unlike tables/PlantUML/Mermaid, an image is an *inline* element — Markdown lets it sit inline with surrounding text — so it's always nested inside a paragraph. Clicking a block's drag handle (the grip icon in the left margin) selects that paragraph, not the image nested inside it, and copying a paragraph selection gives back its content, not the image's file path. This applies even when the paragraph contains nothing but the image.

### Math

- **Insert**: Insert > Math, or the toolbar's Σ button.
- **Update**: click into the formula and edit it in place with MathLive's own LaTeX-style symbol palette.
- **External tools**: not applicable — formulas are edited directly in MDyX.
- Two different math renderers are used on purpose: [MathLive](https://cortexjs.io/mathlive/) while editing, for its interactive symbol palette, and [KaTeX](https://katex.org/) for exported HTML, which just needs lightweight static output with no editor attached.

### PlantUML diagrams

- **Insert**: paste PlantUML source (`@startuml` ... `@enduml`, with or without a ` ```plantuml ` fence around it) with nothing selected, or use Insert > PlantUML Diagram.
- **Update**: select the diagram and paste new source to re-render it.
- **External tools**: copying a selected diagram gives back its PlantUML source, to edit in a dedicated PlantUML editor (e.g. [Blockly PlantUML Editor](https://github.com/patakuti/blockly-plantuml-editor)) and paste back in.
- **Privacy**: rendering a PlantUML diagram sends its source text to a PlantUML server over the network — by default the public `plantuml.com` server. If your diagrams contain sensitive information, point Settings' "PlantUML Server URL" at a self-hosted server (or an internal one) instead. Mermaid diagrams, by contrast, are rendered entirely on-device and never leave your machine — see below.

![Copying a PlantUML diagram from MDyX into Blockly PlantUML Editor, editing it there, then copying it back](samples/demo2.gif)

### Mermaid diagrams

- **Insert**: paste Mermaid source wrapped in a ` ```mermaid ` fenced code block with nothing selected, or use Insert > Mermaid Diagram. Unlike PlantUML, unfenced Mermaid text isn't auto-detected — Mermaid's syntax has no self-contained start/end marker to recognize it by, so the fence is required.
- **Update**: select the diagram and paste new fenced source to re-render it.
- **External tools**: copying a selected diagram writes its source back out wrapped in the same ` ```mermaid ` fence (e.g. to paste into [Mermaid Live Editor](https://mermaid.live/) or a GitHub Markdown file). Diagrams are rendered entirely on-device — no server or network connection involved.

### Links

- **Insert**: Insert > Link (`Ctrl/Cmd+K`, menu or toolbar) opens a dialog for the link text and a URL or file path (with a Browse button, like Insert > Image). Selecting text first pre-fills the text field. Or, select text and click the link icon in the floating toolbar that appears.
- **Update**: click an existing link to edit or remove it from the floating toolbar's tooltip.
- **External tools**: not applicable — links are edited directly in MDyX.

### Find & Replace

- **Find**: `Ctrl/Cmd+F`, or Edit > Find..., opens a floating bar over the document. Type to highlight every match and jump to the nearest one from the cursor; Enter/Shift+Enter (or the ▲/▼ buttons) step to the next/previous match, wrapping at the ends. Escape closes it.
- **Replace**: `Ctrl/Cmd+H`, or Edit > Replace..., adds a replacement field to the same bar. Replace swaps the current match and moves to the next one; Replace All rewrites every match at once (undo it like any other edit — there's no separate confirmation).
- Matching is plain substring, case-insensitive; there's no regular-expression mode.
- **Select All**: `Ctrl/Cmd+A` already works everywhere text is editable (it's the browser's own behavior). Edit > Select All and the editor's right-click menu add an explicit entry for it too, since neither menu had one before.

### Zoom

- `Ctrl+Wheel` over the document zooms in/out, in 10% steps between 50% and 200% — text, tables, math, and PlantUML/Mermaid diagrams all scale together, since it resizes the layout itself rather than just stretching a rendered image. The level is shared across all tabs and remembered between launches.
- View > Zoom In / Zoom Out / Reset Zoom does the same by clicking, for anyone who'd rather not use the wheel.
- **Known limitation (Linux, confirmed by hand on WebKitGTK)**: the keyboard shortcuts shown next to those menu items (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`) don't actually work — WebKitGTK reserves that exact key combination for its own built-in page zoom and consumes the keypress before it ever reaches MDyX, so neither the native menu shortcut nor the app's own key handling can see it. `Ctrl+Wheel` itself is unaffected by this and works normally; only these three keyboard shortcuts are impacted. Use the menu click instead. Windows/macOS behavior hasn't been verified yet.

### Keyboard shortcuts

Menu items no longer show a shortcut hint string next to their label (e.g. "Save    Ctrl+S") — this used to come from Tauri's native menu `accelerator`, which turned out not to work at all on Windows (see below), so shortcut handling for these items now lives in MDyX's own code instead. The shortcuts themselves still work; only the in-menu hint text is gone. They're listed here instead:

| Action | Shortcut |
|---|---|
| New Tab | `Ctrl/Cmd+N` |
| Open | `Ctrl/Cmd+O` |
| Save | `Ctrl/Cmd+S` |
| Save As | `Ctrl/Cmd+Shift+S` |
| Exit | `Ctrl/Cmd+Q` |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y` |
| Find / Replace | `Ctrl/Cmd+F` / `Ctrl/Cmd+H` |
| Bold / Italic / Strikethrough / Inline Code | `Ctrl/Cmd+B` / `Ctrl/Cmd+E` / `Ctrl/Cmd+Shift+X` / `Ctrl/Cmd+Alt+M` |
| Heading 1–6 | `Ctrl/Cmd+Alt+1` – `6` |
| Bullet / Ordered List / Blockquote / Code Block | `Ctrl/Cmd+Shift+8` / `Ctrl/Cmd+Shift+7` / `Ctrl/Cmd+Shift+9` / `Ctrl/Cmd+Alt+C` |
| Horizontal Rule | `Ctrl/Cmd+Alt+H` |
| Insert Table / Image / PlantUML / Mermaid / Link | `Ctrl/Cmd+Alt+T` / `Ctrl/Cmd+Shift+I` / `Ctrl/Cmd+Alt+U` / `Ctrl/Cmd+Alt+E` / `Ctrl/Cmd+K` |
| Zoom In / Out / Reset | `Ctrl/Cmd+=` / `Ctrl/Cmd+-` / `Ctrl/Cmd+0` (see [Zoom](#zoom)'s known limitation) |

- **Known limitation (Windows, reported by a user)**: several of these shortcuts (e.g. `Ctrl+Q`, `Ctrl+Alt+T`) previously didn't work at all on Windows, even though the same menu item worked fine by clicking — WebView2 owns keyboard focus and Tauri's native menu shortcut mechanism never saw the keypress. This has been fixed by moving those shortcuts to MDyX's own key handling (the same mechanism the rest of the table above already used); if you still see one that doesn't work, please report it.

### Export

- **Export > Export to HTML...**: saves the current document as a single, self-contained HTML file (styling and math fonts embedded; images are referenced by an absolute path, not embedded).
- **Export > Open in Browser**: same HTML, written to a temporary file and opened straight in your default browser — handy for a quick look, or for printing to PDF via the browser's own Print dialog (Ctrl/Cmd+P). MDyX doesn't generate PDF itself; your browser's Print-to-PDF already does this well.
- **Styling**: Settings > Theme... picks a built-in theme or points at your own CSS file. The chosen theme applies to both the exported HTML and MDyX's own editing view, so what you see while editing matches what you get. A CSS file written for [markdown-proxy](https://github.com/patakuti/markdown-proxy) (`.markdown-body`-scoped) works as-is. Two exceptions, both limited to the *editing* view only (exported HTML always looks right): math formulas and code syntax highlighting colors don't fully follow a custom theme. In detail — math formulas render into MathLive's own Shadow DOM, which external CSS can't reach; inline/block code syntax colors are driven by the editor framework's own internal color scheme, which isn't exposed for a theme to override.

### Command line

- `mdyx path/to/file.md` opens that file as a new tab, in addition to whatever tabs were restored from your last session. If that file is already open in a tab, MDyX just switches to it rather than opening a duplicate.
- Only one instance of MDyX runs at a time: launching it again — with or without a file argument — is detected and handed off to the already-running instance instead of opening a second window. With a file argument, that file opens as a new tab there (or, again, switches to it if it's already open).
- **Known limitation (Linux, confirmed by hand on GNOME Shell)**: bringing the existing window to the front on a repeat launch doesn't reliably work — GNOME Shell's focus-stealing prevention blocks it, so the window may stay behind whatever you're currently using. Switch to it manually (e.g. from the taskbar/Activities view) if that happens. Process de-duplication itself (never ending up with two copies running) works correctly regardless. Windows/macOS behavior here hasn't been verified yet.

## Getting Started

Prerequisites: [Node.js](https://nodejs.org/) with npm, and [Rust](https://www.rust-lang.org/) (cargo).

```bash
npm install
```

### Run in development

```bash
npm run tauri dev
```

### Build a release binary

```bash
npm run build
npm run tauri build
```

### Downloads / CI

Pushing a `vX.Y.Z` tag builds installers for Windows, macOS (universal), and Linux via GitHub Actions and attaches them as a draft [Release](../../releases). Running the [Release workflow](.github/workflows/release.yml) manually from the Actions tab instead builds the same installers and uploads them as a workflow run [artifact](../../actions/workflows/release.yml) (no Release is created) — use this to get ad-hoc binaries outside of a version bump. Binaries are unsigned, so first launch shows an OS warning: on Windows, click "More info" > "Run anyway" in the SmartScreen dialog; on macOS, right-click the app and choose "Open" (or run `xattr -d com.apple.quarantine <path>`), since it isn't notarized.

## Built With

[Tauri](https://tauri.app/) · [Milkdown](https://milkdown.dev/) + [Crepe](https://milkdown.dev/docs/guide/using-crepe) (ProseMirror + remark) · [MathLive](https://cortexjs.io/mathlive/) for editing, [KaTeX](https://katex.org/) for exported math · plain Markdown as the save format

## About this project

This tool was designed and implemented entirely by Claude. The human provided the idea. However, this isn't a one-shot output; the human shaped it through hands-on testing and iterative, detail-oriented feedback.

## License

[MIT](LICENSE)
