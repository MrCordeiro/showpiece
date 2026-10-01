import { describe, expect, it } from "vitest";
import {
  BEZEL_BORDER,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEVICE_TOP,
  TEXT_MARGIN_X,
  getBezelBox,
  getScreenBox,
  topRoundedRect,
} from "../src/frame/layout.js";

describe("getScreenBox", () => {
  it("starts one bezel border below the fixed device top", () => {
    expect(getScreenBox().y).toBe(DEVICE_TOP + BEZEL_BORDER);
  });

  it("runs to the canvas bottom edge, so the device is cut off there", () => {
    const box = getScreenBox();
    expect(box.y + box.height).toBe(CANVAS_HEIGHT);
  });

  it("is centered horizontally", () => {
    const box = getScreenBox();
    expect(box.x + box.width / 2).toBe(CANVAS_WIDTH / 2);
  });
});

describe("getBezelBox", () => {
  it("expands the screen box by the border on the sides and top", () => {
    const screen = getScreenBox();
    const bezel = getBezelBox();
    expect(bezel.x).toBe(screen.x - BEZEL_BORDER);
    expect(bezel.y).toBe(screen.y - BEZEL_BORDER);
    expect(bezel.width).toBe(screen.width + BEZEL_BORDER * 2);
    expect(bezel.y + bezel.height).toBe(CANVAS_HEIGHT);
  });

  it("is wider than the text column but keeps a side padding", () => {
    const bezel = getBezelBox();
    expect(bezel.x).toBeGreaterThan(TEXT_MARGIN_X);
    expect(bezel.width).toBeGreaterThan(CANVAS_WIDTH * 0.7);
  });
});

describe("topRoundedRect", () => {
  it("extends the rect below the box by two radii so its bottom corners are clipped", () => {
    const rect = topRoundedRect(
      { x: 1, y: 2, width: 30, height: 40 },
      5,
      'fill="#fff"',
    );
    expect(rect).toContain('height="50"');
    expect(rect).toContain('rx="5"');
    expect(rect).toContain('fill="#fff"');
  });
});
