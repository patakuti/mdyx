# MDyX

A LyX-style WYSIWYM Markdown editor.

Detailed requirements and design live in private project docs (`01_requirements.md` / `02_design.md` / `03_plan.md`, all excluded from Git).

## Tech Stack

| Area | Technology |
|---|---|
| Desktop shell | [Tauri](https://tauri.app/) |
| Editor core | [Milkdown](https://milkdown.dev/) (ProseMirror + remark) + [Crepe](https://milkdown.dev/docs/guide/using-crepe) |
| Math input | [MathLive](https://cortexjs.io/mathlive/) `<math-field>`, integrated as a Milkdown node view; Crepe's built-in KaTeX/CodeMirror-based Latex feature is disabled in favor of it |
| PlantUML | `plantuml` Milkdown node view rendering an SVG preview (no in-app source editor — same philosophy as image paths: edit externally and round-trip via copy/paste), backed by a Rust command (`reqwest`) that proxies rendering to a configurable PlantUML server (official server by default) |
| Clipboard | tauri-plugin-clipboard-manager (image paths); Milkdown's built-in clipboard handling (tables/text) |
| Save format | Plain Markdown |

## Setup

Prerequisites: Node.js, npm, and Rust (cargo) must be installed.

```bash
npm install
```

## Development

```bash
npm run tauri dev
```

## Build

```bash
npm run build
npm run tauri build
```

## Current Status

Phase 0-9 complete: a Tauri + Milkdown (Crepe) editor with a native File/Edit/Insert/Settings menu (New Tab / Open / Save / Save As / Exit, Undo / Redo, Insert Table / Image / PlantUML, PlantUML Server settings), an always-visible in-app formatting toolbar (including Merge Cells / Split Cell, Insert Math, Insert PlantUML), table copy/paste (via Milkdown's built-in clipboard + GFM support, plus Insert > Table checking the clipboard for an HTML/Markdown table before falling back to an empty one), image path copy/paste (selecting an image node and copying writes its absolute path as text; pasting a valid image file path — including a `~`-relative one — replaces/inserts the image, with relative-path resolution against the document's folder), tables with merged cells (round-tripped as a raw HTML `<table>` block on save/load, while staying visually and editorially identical to a plain table in the WYSIWYM view), LyX-style math input (MathLive `<math-field>` node views for `$...$`/`$$...$$`, inserted as inline math and switchable to a block/display equation in place, with arrow-key navigation in and out of formulas and MathLive's own symbol palette), PlantUML diagrams (an SVG-only preview node, rendered via a configurable server URL, with no in-app source editor; selecting a diagram and copying puts its source on the clipboard, and pasting any text that's fully an `@startuml`/`@enduml` block auto-inserts a new diagram or updates the currently selected one), keyboard shortcuts for the menu and formatting toolbar (LyX's own bindings where LyX has a direct equivalent, common editor conventions otherwise), the app remembering the last folder used for Open/Save As, and tabbed multi-file editing: the app starts with 0 tabs (no placeholder document), Open reuses an empty untouched tab or creates a new one, closing a tab (or exiting the app) with unsaved changes prompts to Save/Don't Save/Cancel, and the set of open tabs (and which one was active) is restored on the next launch.
