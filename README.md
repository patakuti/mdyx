# MDyX

LyX風 WYSIWYG Markdownエディタ。

詳細な要求仕様・設計は非公開のプロジェクト管理ドキュメント(`01_requirements.md` / `02_design.md` / `03_plan.md`、いずれもGit管理対象外)を参照。

## 技術スタック

| 領域 | 採用技術 |
|---|---|
| デスクトップシェル | [Tauri](https://tauri.app/) |
| エディタコア | [Milkdown](https://milkdown.dev/)(ProseMirror + remark)+ [Crepe](https://milkdown.dev/docs/guide/using-crepe) |
| 数式入力 | MathLive(ノードビューとして統合予定) |
| クリップボード | tauri-plugin-clipboard(予定) |
| 保存フォーマット | 素のMarkdown |

## セットアップ

前提: Node.js, npm, Rust(cargo)がインストール済みであること。

```bash
npm install
```

## 開発

```bash
npm run tauri dev
```

## ビルド

```bash
npm run build
npm run tauri build
```

## 現在の状況

Phase 0(プロジェクト初期化)完了。Tauri + Milkdown(Crepe)の最小構成でエディタが起動する状態。
ファイルの開く/保存、LyX風ツールバー、クリップボード連携、数式、PlantUML連携は未実装(実装計画は`03_plan.md`を参照)。
