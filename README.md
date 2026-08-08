# MDyX

A LyX-style WYSIWYG Markdown editor.

Detailed requirements and design live in private project docs (`01_requirements.md` / `02_design.md` / `03_plan.md`, all excluded from Git).

## Tech Stack

| Area | Technology |
|---|---|
| Desktop shell | [Tauri](https://tauri.app/) |
| Editor core | [Milkdown](https://milkdown.dev/) (ProseMirror + remark) + [Crepe](https://milkdown.dev/docs/guide/using-crepe) |
| Math input | MathLive (planned, integrated as a node view) |
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

Phase 0-5 complete: a Tauri + Milkdown (Crepe) editor with a native File/Edit/Insert menu (Open / Save / Save As, Undo / Redo, Insert Table / Image), an always-visible in-app formatting toolbar (including Merge Cells / Split Cell), table copy/paste (via Milkdown's built-in clipboard + GFM support), image path copy/paste (selecting an image node and copying writes its absolute path as text; pasting a valid image file path replaces/inserts the image, with relative-path resolution against the document's folder), and tables with merged cells (round-tripped as a raw HTML `<table>` block on save/load, while staying visually and editorially identical to a plain table in the WYSIWYG view).
Math input and PlantUML integration are not yet implemented (see `03_plan.md` for the implementation plan).
