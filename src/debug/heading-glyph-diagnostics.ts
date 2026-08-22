// TEMPORARY debug aid for investigating
// https://github.com/patakuti/mdyx/issues/43 (Windows: digits in a heading
// render with inconsistent glyph sizes and a misaligned baseline). Remove
// this file and its Ctrl+Alt+Shift+D wiring in main.ts once the real cause
// is confirmed on a real Windows machine — this is not a shipped feature.
//
// Doesn't rely on WebView2 DevTools (unavailable in a release build without
// the `devtools` Cargo feature): everything is measured in-page and shown in
// an on-screen overlay, so a plain release installer is enough to capture
// real data (01_requirements.md's "no guessing, verify actual values" rule).
//
// Per character, this records two kinds of REAL measurements, never a guess:
// 1. Its actual on-screen bounding box (via Range.getBoundingClientRect) —
//    directly shows whether height/vertical position differ across digits,
//    i.e. the reported symptom itself.
// 2. For every font in the heading's computed font-family stack, the width
//    that single character would have if rendered in exactly that font
//    (via an offscreen canvas' measureText, with no fallback list so the
//    browser can't itself fall back again). Comparing those widths against
//    the real on-screen width from (1) points at which stack font actually
//    rendered each glyph — inferred from a real measured match, not assumed.

interface FontWidthSample {
  font: string;
  width: number;
}

interface GlyphSample {
  char: string;
  index: number;
  rectTop: number;
  rectHeight: number;
  rectWidth: number;
  fontWidths: FontWidthSample[];
  bestMatch: string | null;
  bestMatchDelta: number | null;
}

interface DiagnosticReport {
  headingTag: string;
  headingText: string;
  computedFontFamily: string;
  computedFontSize: string;
  computedFontWeight: string;
  fontStack: string[];
  glyphs: GlyphSample[];
}

function parseFontStack(computedFontFamily: string): string[] {
  return computedFontFamily
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter((entry) => entry.length > 0);
}

function measureCharWidths(
  ctx: CanvasRenderingContext2D,
  char: string,
  fontStack: string[],
  fontSize: string,
  fontWeight: string
): FontWidthSample[] {
  return fontStack.map((font) => {
    // Deliberately no fallback fonts appended: this measures what the glyph
    // would look like if the canvas is forced to use exactly this one font
    // (falling back to the canvas default only if `font` itself has no
    // digit glyph, which none of this stack's fonts lack).
    ctx.font = `${fontWeight} ${fontSize} "${font}"`;
    return { font, width: ctx.measureText(char).width };
  });
}

function findBestMatch(actualWidth: number, samples: FontWidthSample[]): { font: string | null; delta: number | null } {
  let best: FontWidthSample | null = null;
  let bestDelta = Infinity;
  for (const sample of samples) {
    const delta = Math.abs(sample.width - actualWidth);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = sample;
    }
  }
  return best ? { font: best.font, delta: bestDelta } : { font: null, delta: null };
}

/// Finds the first heading (h1-h6) under `root` whose text is purely ASCII
/// digits (the shape reported in #43: "# 0123456789") and measures every
/// character in it. Returns null if no such heading exists yet.
export function diagnoseDigitHeading(root: ParentNode): DiagnosticReport | null {
  const headings = root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
  let target: HTMLElement | null = null;
  for (const heading of headings) {
    const text = heading.textContent ?? "";
    if (/^[0-9]+$/.test(text)) {
      target = heading;
      break;
    }
  }
  if (!target) return null;

  const textNode = Array.from(target.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (!textNode || !textNode.textContent) return null;

  const computed = getComputedStyle(target);
  const fontStack = parseFontStack(computed.fontFamily);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const text = textNode.textContent;
  const glyphs: GlyphSample[] = [];
  for (let i = 0; i < text.length; i++) {
    const range = document.createRange();
    range.setStart(textNode, i);
    range.setEnd(textNode, i + 1);
    const rect = range.getBoundingClientRect();

    const fontWidths = measureCharWidths(ctx, text[i], fontStack, computed.fontSize, computed.fontWeight);
    const { font: bestMatch, delta: bestMatchDelta } = findBestMatch(rect.width, fontWidths);

    glyphs.push({
      char: text[i],
      index: i,
      rectTop: rect.top,
      rectHeight: rect.height,
      rectWidth: rect.width,
      fontWidths,
      bestMatch,
      bestMatchDelta,
    });
  }

  return {
    headingTag: target.tagName.toLowerCase(),
    headingText: text,
    computedFontFamily: computed.fontFamily,
    computedFontSize: computed.fontSize,
    computedFontWeight: computed.fontWeight,
    fontStack,
    glyphs,
  };
}

function formatReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(`<${report.headingTag}> "${report.headingText}"`);
  lines.push(`font-family (computed): ${report.computedFontFamily}`);
  lines.push(`font-size: ${report.computedFontSize}  font-weight: ${report.computedFontWeight}`);
  lines.push("");
  lines.push("Per-character real measurements (top/height/width are actual on-screen px):");
  for (const glyph of report.glyphs) {
    lines.push(
      `  [${glyph.index}] "${glyph.char}"  top=${glyph.rectTop.toFixed(2)}  height=${glyph.rectHeight.toFixed(
        2
      )}  width=${glyph.rectWidth.toFixed(2)}  closest-matching-font="${glyph.bestMatch ?? "?"}" (Δwidth=${
        glyph.bestMatchDelta?.toFixed(2) ?? "?"
      }px)`
    );
    for (const sample of glyph.fontWidths) {
      lines.push(`        ${sample.font}: ${sample.width.toFixed(2)}px`);
    }
  }
  const tops = report.glyphs.map((g) => g.rectTop);
  const heights = report.glyphs.map((g) => g.rectHeight);
  lines.push("");
  lines.push(
    `top spread: ${(Math.max(...tops) - Math.min(...tops)).toFixed(2)}px, ` +
      `height spread: ${(Math.max(...heights) - Math.min(...heights)).toFixed(2)}px`
  );
  return lines.join("\n");
}

const OVERLAY_ID = "mdyx-debug-glyph-overlay";

function showOverlay(text: string): void {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    "position:fixed;inset:20px;z-index:999999;background:#1e1e1e;color:#d4d4d4;" +
    "font-family:monospace;font-size:12px;padding:16px;overflow:auto;border-radius:8px;" +
    "box-shadow:0 4px 24px rgba(0,0,0,0.5);white-space:pre-wrap;";

  const closeButton = document.createElement("button");
  closeButton.textContent = "Close";
  closeButton.style.cssText =
    "position:absolute;top:12px;right:12px;padding:4px 12px;cursor:pointer;";
  closeButton.addEventListener("click", () => overlay.remove());

  const pre = document.createElement("pre");
  pre.style.cssText = "margin:32px 0 0 0;user-select:text;";
  pre.textContent = text;

  overlay.appendChild(closeButton);
  overlay.appendChild(pre);
  document.body.appendChild(overlay);
}

/// Wired to Ctrl+Alt+Shift+D in main.ts. Scans `editorRoot` for a digit-only
/// heading and shows the measurements in an overlay the user can select-all
/// and copy/screenshot — no DevTools required.
export function runHeadingGlyphDiagnostic(editorRoot: ParentNode, onNotFound: () => void): void {
  const report = diagnoseDigitHeading(editorRoot);
  if (!report) {
    onNotFound();
    return;
  }
  showOverlay(formatReport(report));
}
