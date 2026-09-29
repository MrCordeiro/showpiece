import { BEZEL_INNER_RADIUS, BEZEL_OUTER_RADIUS, type Box } from "./layout.js";

/** Neutral hardware color, independent of the frame's own background/theme — real phones don't recolor themselves to match a marketing gradient. */
const BEZEL_COLOR = "#111114";

/**
 * A plain rounded-rect device bezel, generated in SVG rather than shipped as
 * a bundled image (see SPEC.md Open Questions: licensing-free, and simple
 * enough to be "good enough for v0"). `screenBox` is the inner opening where
 * the real screenshot gets composited on top; the bezel is drawn `bezelBox`
 * (screenBox expanded by the border) larger on every side.
 */
export function renderBezelSvg(bezelBox: Box, screenBox: Box): string {
  const cutoutX = screenBox.x - bezelBox.x;
  const cutoutY = screenBox.y - bezelBox.y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bezelBox.width}" height="${bezelBox.height}">
  <rect x="0" y="0" width="${bezelBox.width}" height="${bezelBox.height}" rx="${BEZEL_OUTER_RADIUS}" fill="${BEZEL_COLOR}" />
  <rect x="${cutoutX}" y="${cutoutY}" width="${screenBox.width}" height="${screenBox.height}" rx="${BEZEL_INNER_RADIUS}" fill="#000000" />
</svg>`;
}
