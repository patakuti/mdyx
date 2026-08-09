# MDyX

A LyX-style WYSIWYM Markdown editor.

MDyX lets you edit plain Markdown files with a WYSIWYM ("What You See Is What You Mean") interface in the spirit of [LyX](https://www.lyx.org/): an always-visible menu bar and formatting toolbar instead of raw Markdown syntax, while the file on disk stays plain, portable Markdown that any other editor or tool can open.

## Why MDyX?

- Good WYSIWYG-style Markdown editors turned out to be surprisingly hard to find.
- Markdown is great, but you shouldn't have to learn its syntax to get the benefit of it — the same way LyX lets you write LaTeX documents without writing LaTeX by hand.
- Complex tables and diagrams are best edited in a dedicated tool, not reinvented inside a text editor. MDyX leaves that work to external tools (a spreadsheet, a PlantUML editor, ...) and exchanges data with them through the clipboard, in both directions.

## Features

- Tabbed editing of multiple Markdown files, with your open tabs and window layout restored the next time you launch the app.
- Tables with merged cells, math formulas, and PlantUML diagrams, all edited visually — no Markdown syntax to type or memorize.
- Everything round-trips through the clipboard: copy a table into a spreadsheet and back, and it's still a table. Same for diagrams and images.
- Images are always referenced by path or URL, never embedded as binary data.
- The saved file is plain, ordinary Markdown, readable by any other tool.

## Usage

### Tables

- **Insert**: paste a table (from a spreadsheet, or Markdown pipe syntax) with nothing selected, or use Insert > Table.
- **Update**: select the table and paste a new one to replace it in place.
- **External tools**: copying a selected table writes both an HTML and a Markdown version to the clipboard, so it pastes back correctly into a spreadsheet app too — merged cells included.

### Images

- **Insert**: paste a file path or URL with nothing selected, or use Insert > Image (opens a dialog to type a path/URL or browse for a file, if the clipboard doesn't have a usable one).
- **Update**: select the image and paste a new path/URL to replace it.
- **External tools**: copying a selected image gives you back its file path, to hand off to another program.

### Math

- **Insert**: Insert > Math, or the toolbar's Σ button.
- **Update**: click into the formula and edit it in place with MathLive's own LaTeX-style symbol palette.
- **External tools**: not applicable — formulas are edited directly in MDyX.

### PlantUML diagrams

- **Insert**: paste PlantUML source (`@startuml` ... `@enduml`) with nothing selected, or use Insert > PlantUML Diagram.
- **Update**: select the diagram and paste new source to re-render it.
- **External tools**: copying a selected diagram gives back its PlantUML source, to edit in a dedicated PlantUML editor (e.g. [Blockly PlantUML Editor](https://github.com/patakuti/blockly-plantuml-editor)) and paste back in. Diagrams are rendered by a PlantUML server, configurable in Settings.

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

## Built With

[Tauri](https://tauri.app/) · [Milkdown](https://milkdown.dev/) + [Crepe](https://milkdown.dev/docs/guide/using-crepe) (ProseMirror + remark) · [MathLive](https://cortexjs.io/mathlive/) · plain Markdown as the save format
