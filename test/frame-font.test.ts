import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findAssetPath, loadFont } from "../src/frame/font.js";
import { makeTempDir } from "./temp-dir.js";

describe("findAssetPath", () => {
  it("walks up from a nested directory to find assets/<path>", () => {
    const root = makeTempDir("showpiece-asset-");
    const nested = join(root, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(root, "assets", "fonts"), { recursive: true });
    writeFileSync(join(root, "assets", "fonts", "test.txt"), "hi");

    expect(findAssetPath("fonts/test.txt", nested)).toBe(
      join(root, "assets", "fonts", "test.txt"),
    );
  });

  it("throws when the asset isn't found within maxLevels", () => {
    const root = makeTempDir("showpiece-asset-");
    expect(() => findAssetPath("fonts/nope.txt", root, 1)).toThrow(
      /Could not locate bundled asset/,
    );
  });
});

describe("loadFont", () => {
  it.each(["Metropolis", "Inter"])(
    "loads the bundled %s font with real glyph metrics",
    (name) => {
      const font = loadFont(name);
      expect(font.family).toBe(name);
      expect(font.body.unitsPerEm).toBeGreaterThan(0);
      expect(font.headline.capHeight).toBeGreaterThan(0);

      const run = font.headline.layout("Ag");
      expect(run.glyphs.length).toBeGreaterThan(0);
      expect(run.positions.length).toBe(run.glyphs.length);
      expect(run.advanceWidth).toBeGreaterThan(0);
    },
  );

  it("has the ellipsis glyph that truncation appends", () => {
    const font = loadFont("Metropolis");
    expect(font.headline.hasGlyphForCodePoint(0x2026)).toBe(true);
    expect(font.body.hasGlyphForCodePoint(0x2026)).toBe(true);
  });

  it("throws a clear error for an unknown font name", () => {
    expect(() => loadFont("Comic Sans")).toThrow(/Unknown font "Comic Sans"/);
  });
});
