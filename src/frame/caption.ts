// src/frame/caption.ts
import type { FontAsset, FontkitFont } from "./font.js";
import {
  CANVAS_WIDTH,
  DEVICE_TOP,
  HEADLINE_TOP,
  TEXT_MARGIN_X,
} from "./layout.js";

export interface TextLayout {
  fontSize: number;
  lines: string[];
}

export interface TextStyle {
  /** Candidate sizes, largest first. */
  sizes: readonly number[];
  maxLines: number;
  /** Baseline-to-baseline distance as a multiple of the font size. */
  lineHeight: number;
}

/** DEVICE_TOP in layout.ts leaves room for both styles at their largest size and line count. */
export const HEADLINE_STYLE: TextStyle = {
  sizes: [106, 96, 88, 80, 72],
  maxLines: 2,
  lineHeight: 1,
};
export const SUBTITLE_STYLE: TextStyle = {
  sizes: [40, 36, 32],
  maxLines: 2,
  lineHeight: 1.3,
};

/** Last headline baseline to first subtitle baseline. */
const SUBTITLE_GAP = 88;
const TEXT_MAX_WIDTH = CANVAS_WIDTH - TEXT_MARGIN_X * 2;

/** Average glyph-advance heuristic used only by fitText's pure unit tests, which call it without a real font. renderTextSvg always supplies a real measurer built from actual glyph metrics instead. */
const CHAR_WIDTH_RATIO = 0.58;

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

/**
 * Moves the break of a two-line wrap to the word boundary that makes the
 * longer line shortest. A greedy wrap leaves a short orphan on the second
 * line ("All your money, one / glance"); a balanced wrap gives
 * "All your money, / one glance".
 */
function balanceTwoLines(
  lines: string[],
  fontSize: number,
  measureWidth: MeasureWidth,
): string[] {
  if (lines.length !== 2) return lines;
  const words = lines.join(" ").split(" ");
  let best = lines;
  let bestWidth = Math.max(...lines.map((l) => measureWidth(l, fontSize)));
  for (let i = 1; i < words.length; i++) {
    const candidate = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const width = Math.max(...candidate.map((l) => measureWidth(l, fontSize)));
    if (width < bestWidth) {
      best = candidate;
      bestWidth = width;
    }
  }
  return best;
}

/**
 * Truncates `line` to fit `maxWidth`, appending an ellipsis. If `line`
 * already fits and `forceEllipsis` is false, returns it unchanged.
 * `forceEllipsis` is set on the last kept line when wrapping produced more
 * lines than fit — it shows that content was dropped even when that last
 * line's own text already fits within `maxWidth`.
 */
function truncateLine(
  line: string,
  fontSize: number,
  maxWidth: number,
  measureWidth: MeasureWidth,
  forceEllipsis: boolean,
): string {
  const alreadyFits = measureWidth(line, fontSize) <= maxWidth;
  if (alreadyFits && !forceEllipsis) return line;
  if (alreadyFits && measureWidth(`${line}…`, fontSize) <= maxWidth) {
    return `${line}…`;
  }
  let end = line.length;
  while (
    end > 0 &&
    measureWidth(`${line.slice(0, end)}…`, fontSize) > maxWidth
  ) {
    end--;
  }
  return end > 0 ? `${line.slice(0, end)}…` : "…";
}

/**
 * Picks the largest size in `style.sizes` that is not above `maxSize` and
 * wraps `text` into at most `style.maxLines` lines fitting within
 * `maxWidth`. Never throws. At the smallest size, each kept line is
 * truncated to fit `maxWidth`, and the last kept line gets an ellipsis
 * whenever wrapping produced more lines than were kept, even if that line's
 * own text already fits.
 *
 * `measureWidth` defaults to a fixed-ratio heuristic so this function stays
 * pure and fast for unit testing without a real font; `renderTextSvg`
 * always supplies a real measurer built from actual glyph metrics.
 */
export function fitText(
  text: string,
  style: TextStyle,
  maxWidth: number,
  measureWidth: MeasureWidth = heuristicMeasure,
  maxSize = Number.POSITIVE_INFINITY,
): TextLayout {
  const allowed = style.sizes.filter((size) => size <= maxSize);
  const sizes = allowed.length > 0 ? allowed : style.sizes.slice(-1);
  let lastWrapped: string[] = [];
  for (const fontSize of sizes) {
    const wrapped = wrap(text, fontSize, maxWidth, measureWidth);
    lastWrapped = wrapped;
    if (wrapped.length > style.maxLines) continue;
    if (wrapped.every((l) => measureWidth(l, fontSize) <= maxWidth)) {
      return {
        fontSize,
        lines: balanceTwoLines(wrapped, fontSize, measureWidth),
      };
    }
  }
  const fontSize = sizes[sizes.length - 1] as number;
  const kept = lastWrapped.slice(0, style.maxLines);
  const droppedContent = lastWrapped.length > style.maxLines;
  const lines = kept.map((line, i) =>
    truncateLine(
      line,
      fontSize,
      maxWidth,
      measureWidth,
      droppedContent && i === kept.length - 1,
    ),
  );
  return { fontSize, lines };
}

/**
 * Throws if `text` contains a character `font` has no glyph for. Whitespace
 * is skipped: `wrap()` splits on `/\s+/` and rejoins with a single space, so
 * raw whitespace characters (e.g. a literal newline) are never themselves
 * drawn as glyphs, even when the font lacks a glyph for them.
 */
function assertGlyphsCovered(
  text: string,
  font: FontkitFont,
  family: string,
): void {
  const missing = new Set<string>();
  for (const char of text) {
    if (/\s/.test(char)) continue;
    if (!font.hasGlyphForCodePoint(char.codePointAt(0) as number)) {
      missing.add(char);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `Caption contains characters the bundled ${family} font doesn't support: ${[...missing].join(", ")}. Use plain Latin text (multi-locale font support isn't built yet).`,
    );
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** One font plus the letter spacing it is drawn with. */
interface TextFace {
  font: FontkitFont;
  /** Extra space after each glyph, in em. */
  tracking: number;
}

function headlineFace(font: FontAsset): TextFace {
  return { font: font.headline, tracking: font.headlineTracking };
}

function subtitleFace(font: FontAsset): TextFace {
  return { font: font.body, tracking: 0 };
}

/**
 * Glyph x offsets for one line at `fontSize`, plus the total advance.
 * Measuring and drawing both use this, so wrapping and sizing see the same
 * widths that are drawn.
 */
function layoutLine(face: TextFace, line: string, fontSize: number) {
  const scale = fontSize / face.font.unitsPerEm;
  const run = face.font.layout(line);
  const offsets: number[] = [];
  let x = 0;
  for (const position of run.positions) {
    offsets.push(x);
    x += position.xAdvance * scale + face.tracking * fontSize;
  }
  return { run, scale, offsets, width: x };
}

function measurerFor(face: TextFace): MeasureWidth {
  return (text, fontSize) => layoutLine(face, text, fontSize).width;
}

/**
 * SVG path data for one line of text: glyph outlines scaled to `fontSize`
 * and flipped from the font's y-up em space into SVG's y-down space, laid
 * out left-to-right starting at local x=0 (baseline at y=0).
 */
function lineToPathData(face: TextFace, line: string, fontSize: number) {
  const { run, scale, offsets } = layoutLine(face, line, fontSize);
  const parts: string[] = [];
  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const x = offsets[i];
    if (!glyph || x === undefined) continue; // noUncheckedIndexedAccess guard; fontkit guarantees equal-length arrays
    parts.push(glyph.path.scale(scale, -scale).translate(x, 0).toSVG());
  }
  return parts.join(" ");
}

export interface TextSizes {
  headlineSize?: number;
  subtitleSize?: number;
}

/**
 * The largest headline and subtitle sizes at which every entry fits. Using
 * one size for the whole listing set keeps the screens consistent when a
 * user swipes through them. Callers must pass every screen in the config,
 * not a `--only` subset, or the sizes change between runs.
 */
export function sharedTextSizes(
  texts: { caption: string; subtitle?: string }[],
  font: FontAsset,
): Required<TextSizes> {
  const headline = measurerFor(headlineFace(font));
  const subtitle = measurerFor(subtitleFace(font));
  const fit = (
    values: string[],
    style: TextStyle,
    measure: MeasureWidth,
  ): number =>
    Math.min(
      ...values.map(
        (value) => fitText(value, style, TEXT_MAX_WIDTH, measure).fontSize,
      ),
    );
  return {
    headlineSize: fit(
      texts.map((t) => t.caption).filter(Boolean),
      HEADLINE_STYLE,
      headline,
    ),
    subtitleSize: fit(
      texts.map((t) => t.subtitle ?? "").filter(Boolean),
      SUBTITLE_STYLE,
      subtitle,
    ),
  };
}

function capHeightPx(face: TextFace, fontSize: number): number {
  return (face.font.capHeight / face.font.unitsPerEm) * fontSize;
}

function renderLines(
  face: TextFace,
  layout: TextLayout,
  style: TextStyle,
  firstBaseline: number,
  fill: string,
): string[] {
  return layout.lines.map((line, i) => {
    const y = firstBaseline + i * layout.fontSize * style.lineHeight;
    const d = lineToPathData(face, line, layout.fontSize);
    return `<path d="${d}" transform="translate(${TEXT_MARGIN_X}, ${y.toFixed(2)})" fill="${fill}"/>`;
  });
}

export interface TextInput extends TextSizes {
  caption: string;
  subtitle: string;
  textColor: string;
  font: FontAsset;
}

/**
 * Renders the headline and subtitle as one full-width SVG covering the band
 * above the device, using literal glyph-outline `<path>` elements — not
 * `<text>`/`@font-face`. sharp's bundled librsvg ignores embedded
 * `@font-face` fonts and silently falls back to a system font, which breaks
 * cross-machine determinism. Writing glyphs as literal path geometry
 * removes any dependency on which fonts a given machine has installed.
 * Returns `undefined` when there's nothing to draw.
 */
export function renderTextSvg(input: TextInput): string | undefined {
  const { font } = input;
  assertGlyphsCovered(input.caption, font.headline, font.family);
  assertGlyphsCovered(input.subtitle, font.body, font.family);

  const headline = headlineFace(font);
  const subtitle = subtitleFace(font);
  const fill = escapeAttr(input.textColor);
  const paths: string[] = [];

  const headlineLayout = fitText(
    input.caption,
    HEADLINE_STYLE,
    TEXT_MAX_WIDTH,
    measurerFor(headline),
    input.headlineSize,
  );
  let subtitleBaseline: number | undefined;
  if (headlineLayout.lines.length > 0) {
    const first = HEADLINE_TOP + capHeightPx(headline, headlineLayout.fontSize);
    paths.push(
      ...renderLines(headline, headlineLayout, HEADLINE_STYLE, first, fill),
    );
    const last =
      first +
      (headlineLayout.lines.length - 1) *
        headlineLayout.fontSize *
        HEADLINE_STYLE.lineHeight;
    subtitleBaseline = last + SUBTITLE_GAP;
  }

  const subtitleLayout = fitText(
    input.subtitle,
    SUBTITLE_STYLE,
    TEXT_MAX_WIDTH,
    measurerFor(subtitle),
    input.subtitleSize,
  );
  if (subtitleLayout.lines.length > 0) {
    const first =
      subtitleBaseline ??
      HEADLINE_TOP + capHeightPx(subtitle, subtitleLayout.fontSize);
    paths.push(
      ...renderLines(subtitle, subtitleLayout, SUBTITLE_STYLE, first, fill),
    );
  }

  if (paths.length === 0) return undefined;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${DEVICE_TOP}">
  ${paths.join("\n  ")}
</svg>`;
}
