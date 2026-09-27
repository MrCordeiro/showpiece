import { describe, expect, it } from "vitest";
import { getScreenBox } from "../src/frame/layout.js";
import { renderShadowSvg } from "../src/frame/shadow.js";

describe("renderShadowSvg", () => {
  it("sizes the svg to the full output canvas so it always composites at (0,0)", () => {
    const svg = renderShadowSvg(getScreenBox("minimal"));
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1920"');
  });

  it("draws the shadow rect at the screen box's own position and width", () => {
    const box = getScreenBox("minimal");
    const svg = renderShadowSvg(box);
    expect(svg).toContain(`x="${box.x}"`);
    expect(svg).toContain(`width="${box.width}"`);
  });
});
