import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { FrameTemplate } from "../src/config/schema.js";
import { composeFrame } from "../src/frame/compositor.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures", "frame");

async function toRaw(buffer: Buffer) {
  return sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

const TEMPLATES: {
  template: FrameTemplate;
  background: string | [string, string];
}[] = [
  { template: "gradient", background: ["#1a1a2e", "#16213e"] },
  { template: "solid", background: "#16213e" },
  { template: "minimal", background: ["#1a1a2e", "#16213e"] },
];

describe("frame golden images", () => {
  it.each(TEMPLATES)(
    "matches the committed fixture for $template",
    async ({ template, background }) => {
      const raw = await readFile(join(fixturesDir, "raw", "sample.png"));
      const expected = await readFile(
        join(fixturesDir, "expected", `${template}.png`),
      );

      const actual = await composeFrame({
        raw,
        template,
        background,
        textColor: "#ffffff",
        caption: "Track everything in one place",
        font: "Inter",
      });

      const [a, b] = await Promise.all([toRaw(actual), toRaw(expected)]);
      expect(a.info.width).toBe(b.info.width);
      expect(a.info.height).toBe(b.info.height);

      const diff = pixelmatch(
        a.data,
        b.data,
        undefined,
        a.info.width,
        a.info.height,
        {
          threshold: 0,
        },
      );
      expect(diff).toBe(0);
    },
  );
});
