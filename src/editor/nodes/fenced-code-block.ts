import { codeBlockSchema } from "@milkdown/preset-commonmark";

/// Languages that have their own dedicated node schema (plantuml.ts,
/// mermaid.ts) instead of being rendered as a plain code block.
const CUSTOM_FENCE_LANGUAGES = new Set(["plantuml", "mermaid"]);

/// Crepe's default `code_block` node otherwise claims every mdast `code`
/// node unconditionally (parseMarkdown.match only checks `type === "code"`,
/// see @milkdown/preset-commonmark/src/node/code-block.ts), so without this
/// override it would always win the parser match over `plantumlSchema`/
/// `mermaidSchema` and no ` ```plantuml `/` ```mermaid ` fence would ever
/// reach them. Narrowing the match to exclude those languages leaves every
/// other fenced code block (JS, Python, ...) going through Crepe's own code
/// block exactly as before.
export const nonCustomFenceCodeBlockSchema = codeBlockSchema.extendSchema(
  (factory) => (ctx) => {
    const base = factory(ctx);
    return {
      ...base,
      parseMarkdown: {
        ...base.parseMarkdown,
        match: (node) => node.type === "code" && !CUSTOM_FENCE_LANGUAGES.has((node.lang as string | null) ?? ""),
      },
    };
  }
);
