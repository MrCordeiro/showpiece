import { describe, expect, it } from "vitest";
import { fitCaption, renderCaptionSvg } from "../src/frame/caption.js";
import { loadFont } from "../src/frame/font.js";

describe("fitCaption", () => {
  it("keeps a short caption on one line at the largest size", () => {
    const result = fitCaption("Track everything", 952, 240);
    expect(result.fontSize).toBe(64);
    expect(result.lines).toEqual(["Track everything"]);
  });

  it("returns no lines for an empty caption", () => {
    expect(fitCaption("", 952, 240)).toEqual({ fontSize: 64, lines: [] });
  });

  it("wraps a long caption to at most two lines", () => {
    const result = fitCaption(
      "Find every idea fast across all your notes and notebooks",
      952,
      240,
    );
    expect(result.lines.length).toBeLessThanOrEqual(2);
  });

  it("shrinks the font size rather than overflowing a tighter box", () => {
    const result = fitCaption(
      "A genuinely very long headline that will not fit on two lines at the largest size",
      500,
      160,
    );
    expect(result.fontSize).toBeLessThan(64);
    expect(result.lines.length).toBeLessThanOrEqual(2);
  });

  it("never overflows: falls back to an ellipsis at the smallest size", () => {
    const result = fitCaption(
      "Supercalifragilisticexpialidocious ".repeat(10).trim(),
      300,
      100,
    );
    expect(result.fontSize).toBe(40);
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.lines.at(-1)).toMatch(/…$/);
  });
});

describe("renderCaptionSvg", () => {
  // A real, already-vendored font — a hand-rolled mock object can't prove
  // glyph-outline rendering actually works, which is the whole point of
  // this rework.
  const font = loadFont("Inter");

  it("renders glyph-outline paths, not <text>/@font-face (the librsvg limitation this replaced)", () => {
    const svg = renderCaptionSvg("Track everything", "#ffffff", font);
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
    expect(svg).not.toContain("@font-face");
  });

  it("uses the requested text color as an SVG fill attribute", () => {
    const svg = renderCaptionSvg("Track everything", "#ffffff", font);
    expect(svg).toContain('fill="#ffffff"');
  });

  it("returns undefined for an empty caption (no layer to composite)", () => {
    expect(renderCaptionSvg("", "#ffffff", font)).toBeUndefined();
  });

  it("renders captions containing special characters without escaping issues (text becomes glyph paths, not XML content)", () => {
    const svg = renderCaptionSvg('A & B <script> "quoted"', "#fff", font);
    expect(svg).toContain("<path");
    expect(svg).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  it("wraps a long caption onto two <path> lines", () => {
    const svg = renderCaptionSvg(
      "Find every idea fast across all your notes and notebooks",
      "#ffffff",
      font,
    );
    expect(svg?.match(/<path/g)?.length).toBe(2);
  });
});
