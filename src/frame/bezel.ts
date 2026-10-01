import type { Background } from "./background.js";
import {
  BEZEL_OUTER_RADIUS,
  type Box,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  SCREEN_CORNER_RADIUS,
  topRoundedRect,
} from "./layout.js";

interface BezelStyle {
  fill: string;
  stroke?: string;
}

/** Real phones don't recolor themselves to match a marketing background, so the bezel is always near-black. */
const BEZEL_ON_LIGHT: BezelStyle = { fill: "#1c1c1e" };
/** A near-black bezel disappears on a near-black background, so it gets a lighter grey and an edge stroke there. */
const BEZEL_ON_DARK: BezelStyle = { fill: "#1d1d24", stroke: "#34343e" };
const BEZEL_STROKE_WIDTH = 2;
/** Relative luminance below which the background counts as dark. */
const DARK_BACKGROUND_LUMINANCE = 0.05;

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rgb` or `#rrggbb` color, from 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  let digits = hex.slice(1);
  if (digits.length === 3) {
    digits = [...digits].map((d) => d + d).join("");
  }
  const [r, g, b] = [0, 2, 4].map((i) =>
    channelToLinear(Number.parseInt(digits.slice(i, i + 2), 16)),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function bezelStyleFor(background: Background): BezelStyle {
  const stops = typeof background === "string" ? [background] : background;
  const luminance =
    stops.reduce((sum, stop) => sum + relativeLuminance(stop), 0) /
    stops.length;
  return luminance < DARK_BACKGROUND_LUMINANCE ? BEZEL_ON_DARK : BEZEL_ON_LIGHT;
}

/**
 * A flat, stylized phone outline, generated as a full-canvas SVG so the
 * compositor can place it at (0, 0). The screen opening is a cutout, so the
 * screenshot composited below it shows through with matching corners.
 */
export function renderBezelSvg(
  bezelBox: Box,
  screenBox: Box,
  style: BezelStyle,
): string {
  const half = BEZEL_STROKE_WIDTH / 2;
  // The stroke is centered on the path, so the outline is inset by half its
  // width to keep the device's outer edge at bezelBox.
  const outline = style.stroke
    ? topRoundedRect(
        {
          x: bezelBox.x + half,
          y: bezelBox.y + half,
          width: bezelBox.width - BEZEL_STROKE_WIDTH,
          height: bezelBox.height,
        },
        BEZEL_OUTER_RADIUS - half,
        `fill="none" stroke="${style.stroke}" stroke-width="${BEZEL_STROKE_WIDTH}"`,
      )
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}">
  <defs>
    <mask id="opening">
      <rect width="100%" height="100%" fill="#fff" />
      ${topRoundedRect(screenBox, SCREEN_CORNER_RADIUS, 'fill="#000"')}
    </mask>
  </defs>
  <g mask="url(#opening)">
    ${topRoundedRect(bezelBox, BEZEL_OUTER_RADIUS, `fill="${style.fill}"`)}
    ${outline}
  </g>
</svg>`;
}
