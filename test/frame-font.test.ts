import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findAssetPath, loadFont } from "../src/frame/font.js";

describe("findAssetPath", () => {
  it("walks up from a nested directory to find assets/<path>", () => {
    const root = mkdtempSync(join(tmpdir(), "vitrine-asset-"));
    const nested = join(root, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(root, "assets", "fonts"), { recursive: true });
    writeFileSync(join(root, "assets", "fonts", "test.txt"), "hi");

    expect(findAssetPath("fonts/test.txt", nested)).toBe(
      join(root, "assets", "fonts", "test.txt"),
    );
  });

  it("throws when the asset isn't found within maxLevels", () => {
    const root = mkdtempSync(join(tmpdir(), "vitrine-asset-"));
    expect(() => findAssetPath("fonts/nope.txt", root, 1)).toThrow(
      /Could not locate bundled asset/,
    );
  });
});

describe("loadFont", () => {
  it("loads the bundled Inter font with real glyph metrics", () => {
    const font = loadFont("Inter");
    expect(font.family).toBe("Inter");
    expect(font.regular.unitsPerEm).toBeGreaterThan(0);
    expect(font.bold.unitsPerEm).toBeGreaterThan(0);
    expect(typeof font.bold.layout).toBe("function");

    const run = font.bold.layout("Ag");
    expect(run.glyphs.length).toBeGreaterThan(0);
    expect(run.positions.length).toBe(run.glyphs.length);
    expect(run.advanceWidth).toBeGreaterThan(0);
  });

  it("throws a clear error for an unknown font name", () => {
    expect(() => loadFont("Comic Sans")).toThrow(/Unknown font "Comic Sans"/);
  });
});
