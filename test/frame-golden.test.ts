import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeFrame } from "../src/frame/compositor.js";
import { GOLDEN_CASES } from "./fixtures/frame/cases.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures", "frame");

async function toRaw(buffer: Buffer) {
  return sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

describe("frame golden images", () => {
  it.each(GOLDEN_CASES)(
    "matches the committed fixture for $name",
    async ({ name, ...input }) => {
      const raw = await readFile(join(fixturesDir, "raw", "sample.png"));
      const expected = await readFile(
        join(fixturesDir, "expected", `${name}.png`),
      );

      const actual = await composeFrame({ raw, ...input });

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
          includeAA: true,
        },
      );
      expect(diff).toBe(0);
    },
  );
});
