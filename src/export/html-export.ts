import type { Ctx } from "@milkdown/ctx";
import { editorViewCtx, schemaCtx } from "@milkdown/core";
import { DOMSerializer } from "@milkdown/prose/model";
import type { Node as PMNode } from "@milkdown/prose/model";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import katex from "katex";

import { URL_SCHEME_PATTERN } from "../clipboard/image-paste";
import { getConfig } from "../settings/config";
import { getExportCss } from "../theme/theme-style";

const CUSTOM_ATOM_SELECTOR = '[data-type="math_inline"], [data-type="math_block"], [data-type="plantuml"]';

/// `math_inline`/`math_block`/`plantuml`'s own `toDOM` (nodes/math.ts,
/// nodes/plantuml.ts) only ever renders an empty placeholder carrying the
/// node's *source* as a `data-*` attribute — the live editor never uses
/// `toDOM` for these (it swaps in a NodeView, MathLive/the cached SVG,
/// instead), so it was never given real rendered content to produce. This
/// walks the placeholders `DOMSerializer.serializeFragment` below produced
/// and fills each one in with what Export actually needs, in place:
/// KaTeX-rendered static HTML for math (`renderToString`, since the export
/// pipeline has no live MathLive instance to ask), and the plantuml node's
/// cached SVG (rendering it on demand via the same `render_plantuml`
/// command the live NodeView itself calls, if a tab is exported before its
/// diagrams ever finished their own first render).
///
/// Correlates each placeholder DOM element with its source `PMNode`
/// positionally rather than via any ID: both `doc.descendants` and
/// `DOMSerializer.serializeFragment` are plain depth-first walks over the
/// exact same node tree, so the Nth atom node encountered by one is always
/// the Nth matching placeholder element produced by the other (these atoms
/// have no children, so neither walk can visit them out of order relative
/// to each other).
async function fillCustomAtomPlaceholders(doc: PMNode, container: HTMLElement): Promise<void> {
  const atomNodes: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === "math_inline" || node.type.name === "math_block" || node.type.name === "plantuml") {
      atomNodes.push(node);
    }
    return true;
  });

  const placeholders = container.querySelectorAll<HTMLElement>(CUSTOM_ATOM_SELECTOR);
  let plantumlServerUrl: string | null = null;

  for (let i = 0; i < placeholders.length; i++) {
    const el = placeholders[i];
    const node = atomNodes[i];
    if (!node) continue;

    if (node.type.name === "plantuml") {
      let svg = node.attrs.svg as string;
      if (!svg) {
        plantumlServerUrl ??= (await getConfig()).plantumlServerUrl;
        svg = await invoke<string>("render_plantuml", {
          source: node.attrs.source as string,
          serverUrl: plantumlServerUrl,
        });
      }
      el.innerHTML = svg;
    } else {
      el.innerHTML = katex.renderToString(node.attrs.latex as string, {
        throwOnError: false,
        displayMode: node.type.name === "math_block",
      });
    }
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/// Converts an absolute filesystem path (as returned by
/// `resolve_image_display_path`, forward slashes on Unix, `C:\...` backslashes
/// on Windows) to a `file://` URI usable as an `<img src>` in a document
/// that isn't necessarily served from that same directory.
function absolutePathToFileUrl(absolutePath: string): string {
  const forwardSlashes = absolutePath.replace(/\\/g, "/");
  const rooted = forwardSlashes.startsWith("/") ? forwardSlashes : `/${forwardSlashes}`;
  return `file://${encodeURI(rooted)}`;
}

/// `image`'s `toDOM` (the standard preset-commonmark schema, no local
/// override — setup.ts) emits the raw `src` exactly as saved to the
/// Markdown file, which is only ever meaningful *relative to that Markdown
/// file's own directory* (or already absolute/a URL). The live editor turns
/// that into something the WebView can load via Crepe's `ImageBlock`
/// `proxyDomURL` hook (`resolveImageDisplaySrc`, image-paste.ts) — but
/// Export's `DOMSerializer` pass, going through the schema directly, never
/// touches that display-only layer (deliberately — 18.1節 didn't want the
/// Tauri-specific `convertFileSrc` rewrite leaking into portable output).
///
/// That still leaves plain relative paths unresolved, though, and a
/// relative `src` in the *exported* HTML resolves against wherever *that*
/// file ends up (an arbitrary Export to HTML target directory, or the OS
/// temp dir for Open in Browser) — essentially never the same directory as
/// the source Markdown file. Confirmed by hand: exporting a document with
/// `![x](photo.png)` to a different folder than `photo.png` produced a
/// broken image, exactly as this predicts. Rewriting every non-URL `src` to
/// an absolute `file://` URI here (via the same `resolve_image_display_path`
/// command the live NodeView uses to resolve a relative path against the
/// current file's directory, clipboard.rs) makes the reference independent
/// of the exported file's own location — still a path reference, never
/// embedded binary data (01_requirements.md 10.4節).
async function resolveImageSrcsForExport(container: HTMLElement, activeFilePath: string | null): Promise<void> {
  const images = container.querySelectorAll<HTMLImageElement>("img[src]");
  for (const img of images) {
    const src = img.getAttribute("src");
    if (!src || URL_SCHEME_PATTERN.test(src)) continue;
    const absolute = await invoke<string>("resolve_image_display_path", {
      src,
      currentFilePath: activeFilePath,
    });
    img.setAttribute("src", absolutePathToFileUrl(absolute));
  }
}

/// Serializes the current document straight from the live ProseMirror doc —
/// not via Markdown, unlike File > Save (markdown-io/serializer.ts) — into a
/// complete, styled, standalone HTML document (01_requirements.md 10.1節:
/// B案). Standard nodes (headings, paragraphs, lists, blockquotes, code
/// blocks, tables — including merged cells, since `toDOM` already round-
/// trips `colspan`/`rowspan` faithfully, 4.3節) go through the schema's own
/// `toDOM` via `DOMSerializer`, identical to what the table-copy feature
/// already relies on (html-table.ts).
export async function buildExportHtml(ctx: Ctx, title: string, activeFilePath: string | null): Promise<string> {
  const view = ctx.get(editorViewCtx);
  const schema = ctx.get(schemaCtx);
  const doc = view.state.doc;

  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  const container = document.createElement("div");
  container.appendChild(fragment);
  await fillCustomAtomPlaceholders(doc, container);
  await resolveImageSrcsForExport(container, activeFilePath);

  const css = await getExportCss();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="mdyx-content markdown-body">
${container.innerHTML}
</div>
</body>
</html>
`;
}

/// Export > Export to HTML... (01_requirements.md 10.2節): hands the
/// generated document straight to `export_html` (export.rs), which owns the
/// save dialog. Silent on success/cancel, matching File > Save/Save As's
/// own lack of a success toast — only failures are surfaced.
export async function exportToHtmlFile(ctx: Ctx, title: string, activeFilePath: string | null): Promise<void> {
  const html = await buildExportHtml(ctx, title, activeFilePath);
  await invoke<string | null>("export_html", { content: html });
}

/// Export > Open in Browser (01_requirements.md 10.2節): writes the
/// generated document to a throwaway temp file (`write_temp_html`,
/// export.rs) and opens it with the OS default handler — normally the
/// user's browser, which is also where PDF conversion happens from here on
/// (Ctrl/Cmd+P → Save as PDF), entirely outside MDyX (01_requirements.md
/// 10.1節: no bundled PDF engine).
export async function openExportInBrowser(ctx: Ctx, title: string, activeFilePath: string | null): Promise<void> {
  const html = await buildExportHtml(ctx, title, activeFilePath);
  const path = await invoke<string>("write_temp_html", { content: html, baseName: title });
  await openPath(path);
}
