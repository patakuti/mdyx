# MDyX

A LyX-style WYSIWYG Markdown editor.

Detailed requirements and design live in private project docs (`01_requirements.md` / `02_design.md` / `03_plan.md`, all excluded from Git).

## Tech Stack

| Area | Technology |
|---|---|
| Desktop shell | [Tauri](https://tauri.app/) |
| Editor core | [Milkdown](https://milkdown.dev/) (ProseMirror + remark) + [Crepe](https://milkdown.dev/docs/guide/using-crepe) |
| Math input | MathLive (planned, integrated as a node view) |
| Clipboard | tauri-plugin-clipboard (planned) |
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

Phase 0-1 complete: a minimal Tauri + Milkdown (Crepe) editor with a native File menu (Open / Save / Save As).
The LyX-style in-app toolbar, clipboard integration, math input, and PlantUML integration are not yet implemented (see `03_plan.md` for the implementation plan).
