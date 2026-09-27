import type { FrameTemplate } from "../config/schema.js";

/** Output canvas: Play Store phone screenshot size (9:16 portrait). */
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

/** Horizontal safe margin and vertical band reserved for the caption. */
export const CAPTION_MARGIN_X = 64;
export const CAPTION_TOP = 96;
export const CAPTION_HEIGHT = 240;
const CAPTION_BOTTOM = CAPTION_TOP + CAPTION_HEIGHT; // 336

/** Every template's device sits on the same bottom baseline. */
export const DEVICE_BOTTOM_MARGIN = 64;
const DEVICE_TOP = CAPTION_BOTTOM;
const DEVICE_AVAILABLE_HEIGHT =
  CANVAS_HEIGHT - DEVICE_TOP - DEVICE_BOTTOM_MARGIN;

/** Stylized phone silhouette ratio (width:height) for the bezel templates. */
const BEZEL_DEVICE_ASPECT = 9 / 19.5;
export const BEZEL_BORDER = 22;
export const BEZEL_OUTER_RADIUS = 56;
export const BEZEL_INNER_RADIUS = 34;

/** minimal has no bezel silhouette to respect, so its box just fills the available width. */
const MINIMAL_SIDE_MARGIN = 48;
export const MINIMAL_CORNER_RADIUS = 40;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rect where the raw screenshot itself is drawn (inside any bezel). */
export function getScreenBox(template: FrameTemplate): Box {
  if (template === "minimal") {
    const width = CANVAS_WIDTH - MINIMAL_SIDE_MARGIN * 2;
    return {
      x: MINIMAL_SIDE_MARGIN,
      y: DEVICE_TOP,
      width,
      height: DEVICE_AVAILABLE_HEIGHT,
    };
  }
  const width = Math.round(DEVICE_AVAILABLE_HEIGHT * BEZEL_DEVICE_ASPECT);
  const x = Math.round((CANVAS_WIDTH - width) / 2);
  return { x, y: DEVICE_TOP, width, height: DEVICE_AVAILABLE_HEIGHT };
}

/** The bezel's outer rect (the screen box expanded by the border). gradient/solid only. */
export function getBezelBox(template: FrameTemplate): Box {
  if (template === "minimal") {
    throw new Error('The "minimal" template has no bezel.');
  }
  const screen = getScreenBox(template);
  return {
    x: screen.x - BEZEL_BORDER,
    y: screen.y - BEZEL_BORDER,
    width: screen.width + BEZEL_BORDER * 2,
    height: screen.height + BEZEL_BORDER * 2,
  };
}

/** Corner radius applied to the screenshot's own rounded-rect mask. */
export function getCornerRadius(template: FrameTemplate): number {
  return template === "minimal" ? MINIMAL_CORNER_RADIUS : BEZEL_INNER_RADIUS;
}
