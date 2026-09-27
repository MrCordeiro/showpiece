// src/frame/caption.ts
import type { FontAsset, FontkitFont } from "./font.js";
import { CANVAS_WIDTH, CAPTION_HEIGHT, CAPTION_MARGIN_X } from "./layout.js";

export interface CaptionLayout {
  fontSize: number;
  lines: string[];
}

const FONT_SIZES = [64, 56, 48, 40] as const;
const LINE_HEIGHT_RATIO = 1.25;
/** Average glyph-advance heuristic used only by fitCaption's pure unit tests, which call it without a real font. renderCaptionSvg always supplies a real measurer built from actual glyph metrics instead. */
const CHAR_WIDTH_RATIO = 0.58;
const MAX_LINES = 2;

export type MeasureWidth = (text: string, fontSize: number) => number;

function heuristicMeasure(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_RATIO;
}

function wrap(
  text: string,
  fontSize: number,
  maxWidth: number,
  measureWidth: MeasureWidth,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current === "" || measureWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncate(
  line: string,
  fontSize: number,
  maxWidth: number,
  measureWidth: MeasureWidth,
): string {
  if (measureWidth(line, fontSize) <= maxWidth) return line;
  let end = line.length;
  while (
    end > 1 &&
    measureWidth(`${line.slice(0, end)}…`, fontSize) > maxWidth
  ) {
    end--;
  }
  return `${line.slice(0, end)}…`;
}

/**
 * Picks the largest font size (from {@link FONT_SIZES}) that wraps `text`
 * into at most {@link MAX_LINES} lines fitting within `maxWidth`/`maxHeight`.
 * Never throws. Width is always safe: the smallest size truncates its last
 * line with an ellipsis as a last resort. Height in that fallback path is
 * bounded only by `smallest font size × MAX_LINES`, not checked against
 * `maxHeight` — callers must ensure `maxHeight` is generous enough for that
 * worst case (in this codebase it always is: 40×1.25×2=100 ≤
 * CAPTION_HEIGHT=240).
 *
 * `measureWidth` defaults to a fixed-ratio heuristic so this function stays
 * pure and fast for unit testing without a real font; `renderCaptionSvg`
 * always supplies a real measurer built from actual glyph metrics.
 */
export function fitCaption(
  text: string,
  maxWidth: number,
  maxHeight: number,
  measureWidth: MeasureWidth = heuristicMeasure,
): CaptionLayout {
  let lastWrapped: string[] = [];
  for (const fontSize of FONT_SIZES) {
    const wrapped = wrap(text, fontSize, maxWidth, measureWidth);
    lastWrapped = wrapped;
    if (wrapped.length > MAX_LINES) continue;
    const fits = wrapped.every((l) => measureWidth(l, fontSize) <= maxWidth);
    const height = wrapped.length * fontSize * LINE_HEIGHT_RATIO;
    if (fits && height <= maxHeight) {
      return { fontSize, lines: wrapped };
    }
  }
  const fontSize = FONT_SIZES[FONT_SIZES.length - 1] as number;
  const lines = lastWrapped.slice(0, MAX_LINES);
  const lastIndex = lines.length - 1;
  if (lastIndex >= 0) {
    lines[lastIndex] = truncate(
      lines[lastIndex] as string,
      fontSize,
      maxWidth,
      measureWidth,
    );
  }
  return { fontSize, lines };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Real advance-width measurer built from the font's own glyph metrics. */
function measurerFor(font: FontkitFont): MeasureWidth {
  return (text, fontSize) => {
    const scale = fontSize / font.unitsPerEm;
    return font.layout(text).advanceWidth * scale;
  };
}

/**
 * SVG path data for one line of text: glyph outlines from `font`, scaled to
 * `fontSize` and flipped from the font's y-up em space into SVG's y-down
 * space, laid out left-to-right starting at local x=0 (baseline at y=0).
 */
function lineToPathData(
  font: FontkitFont,
  line: string,
  fontSize: number,
): string {
  const scale = fontSize / font.unitsPerEm;
  const run = font.layout(line);
  let x = 0;
  const parts: string[] = [];
  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const position = run.positions[i];
    if (!glyph || !position) continue; // noUncheckedIndexedAccess guard; fontkit guarantees equal-length arrays
    const path = glyph.path.scale(scale, -scale).translate(x, 0);
    parts.push(path.toSVG());
    x += position.xAdvance * scale;
  }
  return parts.join(" ");
}

/**
 * Renders the caption band as its own full-width SVG using literal
 * glyph-outline `<path>` elements — not `<text>`/`@font-face`. sharp's
 * bundled librsvg ignores embedded `@font-face` fonts and silently falls
 * back to a system font (verified: stripping the `@font-face` block from
 * the old implementation produced a byte-identical PNG), which broke
 * cross-machine determinism. Writing glyphs as literal path geometry here
 * removes any dependency on which fonts a given machine has installed.
 * Returns `undefined` when there's nothing to draw (empty caption).
 */
export function renderCaptionSvg(
  text: string,
  textColor: string,
  font: FontAsset,
): string | undefined {
  const maxWidth = CANVAS_WIDTH - CAPTION_MARGIN_X * 2;
  const measure = measurerFor(font.bold);
  const { fontSize, lines } = fitCaption(
    text,
    maxWidth,
    CAPTION_HEIGHT,
    measure,
  );
  if (lines.length === 0) return undefined;

  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const totalHeight = lineHeight * lines.length;
  const startY = (CAPTION_HEIGHT - totalHeight) / 2 + fontSize;
  const centerX = CANVAS_WIDTH / 2;

  const paths = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      const lineWidth = measure(line, fontSize);
      const x = centerX - lineWidth / 2;
      const d = lineToPathData(font.bold, line, fontSize);
      return `<path d="${d}" transform="translate(${x.toFixed(2)}, ${y.toFixed(2)})" fill="${escapeAttr(textColor)}"/>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CAPTION_HEIGHT}">
  ${paths}
</svg>`;
}
