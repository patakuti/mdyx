import { invoke } from "@tauri-apps/api/core";

import { getConfig } from "../settings/config";
import { showToast } from "../ui/toast";
import baseCss from "./base.css?raw";
import githubTheme from "./themes/github.css?raw";
import katexCss from "./katex-embedded.css?raw";

const BUILTIN_THEMES: Record<string, string> = {
  github: githubTheme,
};

export const DEFAULT_THEME = "github";

export function builtinThemeNames(): string[] {
  return Object.keys(BUILTIN_THEMES);
}

/// Resolves the currently configured theme to its actual CSS text: a
/// built-in theme by name, or (`theme === "custom"`) the file at
/// `customCssPath`, read via the same generic `read_file` command File >
/// Open uses (file_io.rs) — a CSS file needs no special handling beyond
/// "read this path as text". Falls back to the default built-in theme (with
/// a warning toast) if a custom path is missing/unreadable, mirroring how a
/// missing session-restore file degrades (02_design.md 12.7節) rather than
/// leaving the editor/export without any styling at all.
///
/// Theme-only — colors/fonts, not layout. `fullCss` below always layers this
/// on top of `base.css`'s structural rules (padding, table layout, print
/// handling), the same base+theme split markdown-proxy itself uses. Found
/// missing on the first pass (Phase 15, real-machine check): a custom theme
/// file replaced everything wholesale instead of layering, silently losing
/// `.mdyx-content`'s padding/max-width/table structure/print rules since no
/// theme file (including a real markdown-proxy one) would think to
/// redeclare layout it never owned in the first place.
export async function resolveThemeCss(theme: string, customCssPath: string | null): Promise<string> {
  if (theme === "custom") {
    if (!customCssPath) return BUILTIN_THEMES[DEFAULT_THEME];
    try {
      return await invoke<string>("read_file", { path: customCssPath });
    } catch {
      showToast(`Could not read custom CSS file "${customCssPath}" — using the default theme instead.`, "warning");
      return BUILTIN_THEMES[DEFAULT_THEME];
    }
  }
  return BUILTIN_THEMES[theme] ?? BUILTIN_THEMES[DEFAULT_THEME];
}

async function fullCss(): Promise<string> {
  const config = await getConfig();
  const themeCss = await resolveThemeCss(config.theme, config.customCssPath);
  return `${baseCss}\n${themeCss}`;
}

let styleEl: HTMLStyleElement | null = null;

function ensureStyleEl(): HTMLStyleElement {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "mdyx-theme";
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

/// `body { color/background/font-family }` is how markdown-proxy's own
/// theme files (and this project's own base/theme convention, matching it)
/// set the content area's base look — correct in markdown-proxy, where
/// `body` effectively *is* the content wrapper. In MDyX, `.mdyx-content`
/// (the ProseMirror root) is nested deep inside the real `<body>` alongside
/// the toolbar/tab bar, so a `body {...}` rule only ever reaches it via
/// inheritance — and inheritance loses to *any* direct rule on the element
/// itself regardless of `!important`, which is exactly what Crepe has
/// (`.milkdown .ProseMirror { color: var(--crepe-color-on-background) }`,
/// reset.css). Confirmed via a real computed-style dump (`Ctrl+Alt+D`/
/// Settings > Debug: Dump Styles, added during Phase 15 review to avoid a
/// WebKitGTK inspector freeze reported mid-session): every rule with a
/// *non*-`body` selector (`.markdown-body h1`, `.markdown-body a`, table
/// border-color, ...) was already taking effect correctly after
/// `!important`-boosting alone — only the bare `body` rule's color/
/// background/font-family never reached `.mdyx-content` at all, which is
/// what "only partially applied" actually was. Aliasing a bare `body`
/// selector to also directly target `.mdyx-content` turns it into a direct
/// rule on the same element Crepe styles, so the existing `!important`
/// boost (below) is then enough to win outright.
function aliasBodySelector(selectorText: string): string {
  const parts = selectorText.split(",").map((part) => part.trim());
  const aliased = parts.flatMap((part) => (part === "body" ? [part, ".mdyx-content"] : [part]));
  return aliased.join(", ");
}

function boostedRuleText(rule: CSSRule): string {
  if (rule instanceof CSSMediaRule) {
    return `@media ${rule.conditionText} {\n${Array.from(rule.cssRules).map(boostedRuleText).join("\n")}\n}`;
  }
  if (!(rule instanceof CSSStyleRule)) {
    // @font-face, @keyframes, etc.: nothing here competes with Crepe's own
    // editor chrome, so these pass through unboosted.
    return rule.cssText;
  }
  const declarations: string[] = [];
  for (let i = 0; i < rule.style.length; i++) {
    const property = rule.style.item(i);
    declarations.push(`${property}: ${rule.style.getPropertyValue(property)} !important;`);
  }
  return `${aliasBodySelector(rule.selectorText)} { ${declarations.join(" ")} }`;
}

/// Every one of Crepe's own content-area rules (reset.css, table.css, ...)
/// is scoped `.milkdown .ProseMirror h1`/`.milkdown .milkdown-table-block
/// th`/etc. — *two* classes — which beats a plain `.mdyx-content h1` or an
/// arbitrary custom CSS file's own `.markdown-body h1` (confirmed directly:
/// pointing Settings > Theme... at a real markdown-proxy theme file only
/// applied rules with no competing Crepe selector at all — see
/// `aliasBodySelector` above for the other, larger half of that same
/// investigation). No cascade order fix helps here since it's a genuine
/// specificity difference, not a load-order tie, and no re-selectoring of
/// Crepe's CSS (out of this project's control) or of an arbitrary custom
/// CSS file's own selectors is possible. Marking every declaration
/// `!important` — parsed and reconstructed via the CSSOM so this works
/// uniformly on both the built-in theme and any custom file, with no
/// cooperation required from either — is the standard, deliberate
/// mechanism CSS itself provides for exactly this "user style must win
/// over component style" situation.
function boostSpecificity(cssText: string): string {
  const probe = document.createElement("style");
  probe.textContent = cssText;
  document.head.appendChild(probe);
  const rules = probe.sheet ? Array.from(probe.sheet.cssRules) : [];
  probe.remove();
  return rules.length > 0 ? rules.map(boostedRuleText).join("\n") : cssText;
}

/// Applies the currently configured theme to the live editor (01_requirements.md
/// 10.3節: "MDyXの編集画面自体にもリアルタイムに適用"), by writing the theme CSS
/// into a single shared `<style>` element. Relies on `setup.ts` having
/// tagged the editor's ProseMirror root with the same `mdyx-content` class
/// the theme CSS's selectors (and Export's own output, html-export.ts) are
/// written against. Called once at startup and again whenever the theme
/// setting changes (settings-panel.ts) — not on every keystroke, since the
/// theme itself doesn't change that often.
///
/// Deliberately excludes katex-embedded.css: the live editor renders math
/// via MathLive's `<math-field>` (Shadow DOM, styled separately in
/// styles.css), never via static KaTeX HTML — that only happens at Export
/// time (html-export.ts), which calls `getExportCss` below instead.
export async function applyEditorTheme(): Promise<void> {
  const css = await fullCss();
  // Only the live editor needs the `!important` boost (below) — Export's
  // own standalone HTML (getExportCss) has no competing Crepe CSS to lose
  // a specificity contest against, so its output stays a plain, readable
  // copy of the theme.
  ensureStyleEl().textContent = boostSpecificity(css);
}

/// Same base+theme CSS the live editor uses, plus KaTeX's own stylesheet
/// (fonts embedded as data: URIs, so the exported HTML needs no sibling
/// font files to render math — see katex-embedded.css's own doc comment).
/// Math rendering isn't an optional "look" the way a theme choice is, so
/// it's always included regardless of which theme is active.
export async function getExportCss(): Promise<string> {
  const css = await fullCss();
  return `${katexCss}\n${css}`;
}
