import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./layout.js";

/** Solid color, or a two-stop linear gradient (top-left to bottom-right). Already hex-regex-validated by configSchema, so escaping here is defensive only. */
export type Background = string | [string, string];

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;");
}

export function renderBackgroundSvg(background: Background): string {
  if (typeof background === "string") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}">
  <rect width="100%" height="100%" fill="${escapeAttr(background)}" />
</svg>`;
  }
  const [from, to] = background;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeAttr(from)}" />
      <stop offset="100%" stop-color="${escapeAttr(to)}" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
</svg>`;
}
