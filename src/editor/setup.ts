import { Crepe } from "@milkdown/crepe";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

export async function setupEditor(root: HTMLElement): Promise<Crepe> {
  const crepe = new Crepe({
    root,
    defaultValue: "# MDyX\n\nWYSIWYG Markdown editor.\n",
  });

  await crepe.create();
  return crepe;
}
