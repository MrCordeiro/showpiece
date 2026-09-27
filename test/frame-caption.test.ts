import { describe, expect, it } from "vitest";
import { fitCaption, renderCaptionSvg } from "../src/frame/caption.js";
import type { FontAsset } from "../src/frame/font.js";

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
  const font: FontAsset = {
    family: "Inter",
    regularDataUri: "data:font/woff2;base64,AAAA",
    boldDataUri: "data:font/woff2;base64,BBBB",
  };

  it("embeds the bold font and the requested text color", () => {
    const svg = renderCaptionSvg("Track everything", "#ffffff", font);
    expect(svg).toContain(font.boldDataUri);
    expect(svg).toContain("fill: #ffffff");
  });

  it("returns undefined for an empty caption (no layer to composite)", () => {
    expect(renderCaptionSvg("", "#ffffff", font)).toBeUndefined();
  });

  it("escapes markup-significant characters in the caption text", () => {
    const svg = renderCaptionSvg("A & B <script>", "#fff", font);
    expect(svg).toContain("A &amp; B &lt;script&gt;");
  });
});
