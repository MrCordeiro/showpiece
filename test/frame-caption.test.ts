import { describe, expect, it } from "vitest";
import {
  HEADLINE_STYLE,
  SUBTITLE_STYLE,
  type TextStyle,
  fitText,
  renderTextSvg,
  sharedTextSizes,
} from "../src/frame/caption.js";
import { loadFont } from "../src/frame/font.js";

const STYLE: TextStyle = {
  sizes: [64, 56, 48, 40],
  maxLines: 2,
  lineHeight: 1,
};

describe("fitText", () => {
  it("keeps a short text on one line at the largest size", () => {
    const result = fitText("Track everything", STYLE, 952);
    expect(result.fontSize).toBe(64);
    expect(result.lines).toEqual(["Track everything"]);
  });

  it("returns no lines for an empty text", () => {
    expect(fitText("", STYLE, 952)).toEqual({ fontSize: 64, lines: [] });
  });

  it("wraps a long text to at most two lines", () => {
    const result = fitText(
      "Find every idea fast across all your notes and notebooks",
      STYLE,
      952,
    );
    expect(result.lines.length).toBeLessThanOrEqual(2);
  });

  it("balances a two-line wrap instead of leaving an orphan word", () => {
    // Greedy wrapping at this width gives "aaaa bbbb cccc" / "dddd".
    const result = fitText("aaaa bbbb cccc dddd", STYLE, 520);
    expect(result.lines).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  it("shrinks the font size rather than overflowing a narrower box", () => {
    const result = fitText(
      "A genuinely very long headline that will not fit on two lines at the largest size",
      STYLE,
      1100,
    );
    expect(result.fontSize).toBeLessThan(64);
    expect(result.lines.length).toBeLessThanOrEqual(2);
  });

  it("never uses a size above maxSize", () => {
    expect(fitText("Short", STYLE, 952, undefined, 50).fontSize).toBe(48);
  });

  it("never overflows: falls back to an ellipsis at the smallest size", () => {
    const result = fitText(
      "Supercalifragilisticexpialidocious ".repeat(10).trim(),
      STYLE,
      300,
    );
    expect(result.fontSize).toBe(40);
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.lines.at(-1)).toMatch(/…$/);
  });

  it("truncates every overflowing line, not just the last one", () => {
    const result = fitText(
      "Supercalifragilisticexpialidociousextraordinaryapp reallylongsecondword",
      STYLE,
      300,
    );
    for (const line of result.lines) {
      expect(line.length * result.fontSize * 0.58).toBeLessThanOrEqual(300);
    }
  });

  it("adds an ellipsis to the last kept line when wrapping drops extra lines, even if that line itself fits", () => {
    const result = fitText(
      "one two three four five six seven eight nine ten eleven twelve",
      STYLE,
      200,
    );
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.lines.at(-1)).toMatch(/…$/);
  });
});

describe("sharedTextSizes", () => {
  const font = loadFont("Metropolis");

  it("uses the size of the caption that needs the smallest one", () => {
    const short = sharedTextSizes([{ caption: "Short" }], font);
    const mixed = sharedTextSizes(
      [
        { caption: "Short" },
        {
          caption:
            "A much longer headline that needs a smaller size to fit in two lines",
        },
      ],
      font,
    );
    expect(short.headlineSize).toBe(HEADLINE_STYLE.sizes[0]);
    expect(mixed.headlineSize).toBeLessThan(short.headlineSize);
  });

  it("does not cap a style that no screen uses", () => {
    const sizes = sharedTextSizes([{ caption: "Short" }], font);
    expect(sizes.subtitleSize).toBeGreaterThanOrEqual(
      SUBTITLE_STYLE.sizes[0] as number,
    );
  });
});

describe("renderTextSvg", () => {
  // A real, already-vendored font: a hand-rolled mock object can't prove
  // glyph-outline rendering actually works.
  const font = loadFont("Metropolis");
  const base = { caption: "", subtitle: "", textColor: "#ffffff", font };

  it("renders glyph-outline paths, not <text>/@font-face", () => {
    const svg = renderTextSvg({ ...base, caption: "Track everything" });
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
    expect(svg).not.toContain("@font-face");
  });

  it("uses the requested text color as an SVG fill attribute", () => {
    const svg = renderTextSvg({ ...base, caption: "Track everything" });
    expect(svg).toContain('fill="#ffffff"');
  });

  it("returns undefined when there is no caption and no subtitle", () => {
    expect(renderTextSvg(base)).toBeUndefined();
  });

  it("left-aligns every line at the text margin", () => {
    const svg = renderTextSvg({
      ...base,
      caption: "Track everything",
      subtitle: "In one place",
    });
    expect(svg?.match(/translate\(96, /g)?.length).toBe(2);
  });

  it("draws a subtitle when there is no caption", () => {
    const svg = renderTextSvg({ ...base, subtitle: "Only a subtitle" });
    expect(svg?.match(/<path/g)?.length).toBe(1);
  });

  it("renders text containing special characters without escaping issues (text becomes glyph paths, not XML content)", () => {
    const svg = renderTextSvg({ ...base, caption: 'A & B <script> "quoted"' });
    expect(svg).toContain("<path");
    expect(svg).toMatch(/<svg[\s\S]*<\/svg>/);
  });

  it("wraps a long caption onto two <path> lines", () => {
    const svg = renderTextSvg({
      ...base,
      caption: "Find every idea fast across all your notes and notebooks",
    });
    expect(svg?.match(/<path/g)?.length).toBe(2);
  });

  it("throws a clear error naming the font for characters it doesn't support", () => {
    expect(() => renderTextSvg({ ...base, caption: "日本語" })).toThrow(
      /characters the bundled Metropolis font doesn't support/,
    );
    expect(() => renderTextSvg({ ...base, subtitle: "日本語" })).toThrow(
      /Metropolis/,
    );
  });
});
