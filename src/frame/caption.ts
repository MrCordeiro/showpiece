import type { FontAsset } from "./font.js";
import { CANVAS_WIDTH, CAPTION_HEIGHT, CAPTION_MARGIN_X } from "./layout.js";

export interface CaptionLayout {
  fontSize: number;
  lines: string[];
}

const FONT_SIZES = [64, 56, 48, 40] as const;
const LINE_HEIGHT_RATIO = 1.25;
/** Average glyph-advance heuristic for Inter Bold; see the note above `fitCaption`. */
const CHAR_WIDTH_RATIO = 0.58;
const MAX_LINES = 2;

function estimateWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_RATIO;
}

function wrap(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current === "" || estimateWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncate(line: string, fontSize: number, maxWidth: number): string {
  if (estimateWidth(line, fontSize) <= maxWidth) return line;
  let end = line.length;
  while (
    end > 1 &&
    estimateWidth(`${line.slice(0, end)}…`, fontSize) > maxWidth
  ) {
    end--;
  }
  return `${line.slice(0, end)}…`;
}

/**
 * Picks the largest font size (from {@link FONT_SIZES}) that wraps `text`
 * into at most {@link MAX_LINES} lines fitting within `maxWidth`/`maxHeight`.
 * Never throws and never returns overflow. Width is always safe: the
 * smallest size truncates its last line with an ellipsis as a last resort.
 * Height in the fallback path is bounded by `smallest font size × MAX_LINES`,
 * not checked against `maxHeight` — callers must ensure `maxHeight` is
 * generous enough for that worst case.
 * Pure and deterministic (same text/box in, same layout out).
 */
export function fitCaption(
  text: string,
  maxWidth: number,
  maxHeight: number,
): CaptionLayout {
  let lastWrapped: string[] = [];
  for (const fontSize of FONT_SIZES) {
    const wrapped = wrap(text, fontSize, maxWidth);
    lastWrapped = wrapped;
    if (wrapped.length > MAX_LINES) continue;
    const fits = wrapped.every((l) => estimateWidth(l, fontSize) <= maxWidth);
    const height = wrapped.length * fontSize * LINE_HEIGHT_RATIO;
    if (fits && height <= maxHeight) {
      return { fontSize, lines: wrapped };
    }
  }
  const fontSize = FONT_SIZES[FONT_SIZES.length - 1] as number;
  const lines = lastWrapped.slice(0, MAX_LINES);
  const lastIndex = lines.length - 1;
  if (lastIndex >= 0) {
    lines[lastIndex] = truncate(lines[lastIndex] as string, fontSize, maxWidth);
  }
  return { fontSize, lines };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renders the caption band as its own full-width SVG, or `undefined` when there's nothing to draw (empty caption). */
export function renderCaptionSvg(
  text: string,
  textColor: string,
  font: FontAsset,
): string | undefined {
  const maxWidth = CANVAS_WIDTH - CAPTION_MARGIN_X * 2;
  const { fontSize, lines } = fitCaption(text, maxWidth, CAPTION_HEIGHT);
  if (lines.length === 0) return undefined;

  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const totalHeight = lineHeight * lines.length;
  const startY = (CAPTION_HEIGHT - totalHeight) / 2 + fontSize;
  const centerX = CANVAS_WIDTH / 2;

  const tspans = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<tspan x="${centerX}" y="${y.toFixed(1)}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CAPTION_HEIGHT}">
  <style>
    @font-face {
      font-family: "VitrineCaption";
      src: url(${font.boldDataUri}) format("woff2");
      font-weight: 700;
    }
    text {
      font-family: "VitrineCaption";
      font-weight: 700;
      font-size: ${fontSize}px;
      fill: ${textColor};
      text-anchor: middle;
    }
  </style>
  <text>${tspans}</text>
</svg>`;
}
