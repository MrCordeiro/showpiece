import { describe, expect, it } from "vitest";
import {
  BEZEL_BORDER,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEVICE_BOTTOM_MARGIN,
  MINIMAL_CORNER_RADIUS,
  getBezelBox,
  getCornerRadius,
  getScreenBox,
} from "../src/frame/layout.js";

const TEMPLATES = ["gradient", "solid", "minimal"] as const;

describe("getScreenBox", () => {
  it("keeps every template's screen box within the canvas", () => {
    for (const template of TEMPLATES) {
      const box = getScreenBox(template);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(box.y + box.height).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it("bottom-aligns every template's screen box on the same baseline", () => {
    for (const template of TEMPLATES) {
      const box = getScreenBox(template);
      expect(box.y + box.height).toBe(CANVAS_HEIGHT - DEVICE_BOTTOM_MARGIN);
    }
  });

  it("gives minimal a wider screen box than the bezel templates (more product, less chrome)", () => {
    expect(getScreenBox("minimal").width).toBeGreaterThan(
      getScreenBox("gradient").width,
    );
  });

  it("centers the bezel templates' screen box horizontally", () => {
    const box = getScreenBox("gradient");
    expect(box.x + box.width / 2).toBeCloseTo(CANVAS_WIDTH / 2, 0);
  });

  it("gives gradient and solid the same screen box (they differ only in background)", () => {
    expect(getScreenBox("gradient")).toEqual(getScreenBox("solid"));
  });
});

describe("getBezelBox", () => {
  it("expands the screen box by the bezel border on every side", () => {
    const screen = getScreenBox("gradient");
    const bezel = getBezelBox("gradient");
    expect(bezel.x).toBe(screen.x - BEZEL_BORDER);
    expect(bezel.y).toBe(screen.y - BEZEL_BORDER);
    expect(bezel.width).toBe(screen.width + BEZEL_BORDER * 2);
    expect(bezel.height).toBe(screen.height + BEZEL_BORDER * 2);
  });

  it("throws for the minimal template, which has no bezel", () => {
    expect(() => getBezelBox("minimal")).toThrow(/no bezel/);
  });
});

describe("getCornerRadius", () => {
  it("uses the minimal template's own (larger) corner radius", () => {
    expect(getCornerRadius("minimal")).toBe(MINIMAL_CORNER_RADIUS);
  });

  it("uses the same radius for gradient and solid", () => {
    expect(getCornerRadius("gradient")).toBe(getCornerRadius("solid"));
  });
});
