import {
  type Box,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MINIMAL_CORNER_RADIUS,
} from "./layout.js";

const SHADOW_BLUR = 16;
const SHADOW_OFFSET_Y = 12;
const SHADOW_OPACITY = 0.3;

/**
 * The minimal template's soft drop shadow, rendered as its own full-canvas
 * SVG (not just sized to the shadow's bounds) so the compositor can always
 * place it at `(0, 0)` — no negative offsets to worry about near the
 * screen box's edges.
 */
export function renderShadowSvg(screenBox: Box): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}">
  <defs>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${SHADOW_BLUR}" />
    </filter>
  </defs>
  <rect
    x="${screenBox.x}"
    y="${screenBox.y + SHADOW_OFFSET_Y}"
    width="${screenBox.width}"
    height="${screenBox.height}"
    rx="${MINIMAL_CORNER_RADIUS}"
    fill="black"
    fill-opacity="${SHADOW_OPACITY}"
    filter="url(#blur)"
  />
</svg>`;
}
