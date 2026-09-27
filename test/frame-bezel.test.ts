import { describe, expect, it } from "vitest";
import { renderBezelSvg } from "../src/frame/bezel.js";
import { getBezelBox, getScreenBox } from "../src/frame/layout.js";

describe("renderBezelSvg", () => {
  it("sizes the svg to the bezel's own outer box", () => {
    const screenBox = getScreenBox("gradient");
    const bezelBox = getBezelBox("gradient");
    const svg = renderBezelSvg(bezelBox, screenBox);
    expect(svg).toContain(`width="${bezelBox.width}"`);
    expect(svg).toContain(`height="${bezelBox.height}"`);
  });

  it("positions the screen cutout inset from the bezel's own origin by the border", () => {
    const screenBox = getScreenBox("gradient");
    const bezelBox = getBezelBox("gradient");
    const svg = renderBezelSvg(bezelBox, screenBox);
    expect(svg).toContain(`x="${screenBox.x - bezelBox.x}"`);
    expect(svg).toContain(`y="${screenBox.y - bezelBox.y}"`);
    expect(svg).toContain(`width="${screenBox.width}"`);
    expect(svg).toContain(`height="${screenBox.height}"`);
  });
});
