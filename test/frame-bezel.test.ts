import { describe, expect, it } from "vitest";
import {
  bezelStyleFor,
  relativeLuminance,
  renderBezelSvg,
} from "../src/frame/bezel.js";
import { getBezelBox, getScreenBox } from "../src/frame/layout.js";

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white, in both hex lengths", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#fff")).toBeCloseTo(1);
  });
});

describe("bezelStyleFor", () => {
  it("uses a plain near-black bezel on a light or saturated background", () => {
    expect(bezelStyleFor("#3ccf91").stroke).toBeUndefined();
    expect(bezelStyleFor("#ffd93d").stroke).toBeUndefined();
  });

  it("adds an edge stroke on a near-black background so the outline stays visible", () => {
    expect(bezelStyleFor("#000000").stroke).toBeDefined();
    expect(bezelStyleFor(["#0a0a0a", "#111111"]).stroke).toBeDefined();
  });
});

describe("renderBezelSvg", () => {
  it("is a full-canvas svg so it composites at (0, 0)", () => {
    const svg = renderBezelSvg(
      getBezelBox(),
      getScreenBox(),
      bezelStyleFor("#3ccf91"),
    );
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1920"');
  });

  it("cuts the screen opening out of the bezel with a mask", () => {
    const screen = getScreenBox();
    const svg = renderBezelSvg(getBezelBox(), screen, bezelStyleFor("#fff"));
    expect(svg).toContain('mask="url(#opening)"');
    expect(svg).toContain(`x="${screen.x}" y="${screen.y}"`);
  });

  it("draws the stroke only for the dark-background style", () => {
    const box = getBezelBox();
    const screen = getScreenBox();
    expect(renderBezelSvg(box, screen, bezelStyleFor("#fff"))).not.toContain(
      "stroke=",
    );
    expect(renderBezelSvg(box, screen, bezelStyleFor("#000"))).toContain(
      "stroke=",
    );
  });
});
