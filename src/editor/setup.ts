import { Crepe } from "@milkdown/crepe";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

import { imageClipboardPlugin, setupImagePasteInterceptor } from "../clipboard/image-clipboard-plugin";
import { resolveImageDisplaySrc } from "../clipboard/image-paste";

export async function setupEditor(root: HTMLElement): Promise<Crepe> {
  const crepe = new Crepe({
    root,
    defaultValue: "# MDyX\n\nWYSIWYG Markdown editor.\n",
    featureConfigs: {
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: resolveImageDisplaySrc,
      },
    },
  });
  crepe.editor.use(imageClipboardPlugin);

  await crepe.create();
  setupImagePasteInterceptor(root, crepe);
  return crepe;
}
