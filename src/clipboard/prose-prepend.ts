import type { Ctx, MilkdownPlugin } from "@milkdown/ctx";
import { prosePluginsCtx, SchemaReady } from "@milkdown/core";
import type { Plugin as ProseMirrorPlugin } from "@milkdown/prose/state";

/// Like `@milkdown/utils`'s `$prose`, but prepends the plugin instead of
/// appending it. `view.someProp("handlePaste", ...)` (prosemirror-view's
/// paste handling) stops at the first plugin whose `handlePaste` returns
/// `true`, in `state.plugins` order — and Crepe's built-in
/// `@milkdown/plugin-clipboard` (which unconditionally turns any plain-text
/// paste into inserted text) is already registered by the time `.use()`
/// plugins in setup.ts run, so appending via `$prose` here would leave our
/// `handlePaste` unreachable. Confirmed empirically in a browser test
/// (02_design.md 4.4節): dumping `view.state.plugins` showed Milkdown's
/// clipboard plugin at index 8 of 29 with a `$prose`-appended version of
/// this plugin trailing at index 24, and its `handlePaste` was never
/// invoked. Prepending instead puts ours first. Shared by every
/// `handlePaste`-based auto-detect plugin (PlantUML/table/image,
/// Phase 7/11, 02_design.md 14.1節/14.2節).
export function prosePrepend(prose: (ctx: Ctx) => ProseMirrorPlugin): MilkdownPlugin {
  return (ctx) => async () => {
    await ctx.wait(SchemaReady);
    const prosePlugin = prose(ctx);
    ctx.update(prosePluginsCtx, (ps) => [prosePlugin, ...ps]);
    return () => {
      ctx.update(prosePluginsCtx, (ps) => ps.filter((x) => x !== prosePlugin));
    };
  };
}
