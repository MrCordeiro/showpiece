/** Output canvas: Play Store phone screenshot size (9:16 portrait). */
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

/** Left edge of the headline and subtitle. Text is left-aligned. */
export const TEXT_MARGIN_X = 96;
/** Cap-height top of the first headline line. */
export const HEADLINE_TOP = 130;

/**
 * The device top is fixed for every screen, so the phones line up across the
 * listing set whatever the headline and subtitle length. The text band above
 * it must fit two headline lines plus two subtitle lines at the largest sizes
 * in caption.ts.
 */
export const DEVICE_TOP = 560;
const DEVICE_WIDTH = 800;
export const BEZEL_BORDER = 20;
export const BEZEL_OUTER_RADIUS = 110;
export const SCREEN_CORNER_RADIUS = BEZEL_OUTER_RADIUS - BEZEL_BORDER;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The visible part of the screen opening, where the raw screenshot is drawn.
 * It runs to the canvas bottom edge: the device continues below the canvas,
 * so its bottom corners are never drawn.
 */
export function getScreenBox(): Box {
  const deviceX = (CANVAS_WIDTH - DEVICE_WIDTH) / 2;
  const y = DEVICE_TOP + BEZEL_BORDER;
  return {
    x: deviceX + BEZEL_BORDER,
    y,
    width: DEVICE_WIDTH - BEZEL_BORDER * 2,
    height: CANVAS_HEIGHT - y,
  };
}

/** The visible part of the device's outer edge (the screen box expanded by the border). */
export function getBezelBox(): Box {
  const screen = getScreenBox();
  return {
    x: screen.x - BEZEL_BORDER,
    y: DEVICE_TOP,
    width: screen.width + BEZEL_BORDER * 2,
    height: CANVAS_HEIGHT - DEVICE_TOP,
  };
}

/**
 * A rounded rect whose top corners are inside `box` and whose bottom corners
 * are below it, so an SVG of `box`'s size shows only the top corners. Used for
 * every shape that continues past the canvas bottom edge.
 */
export function topRoundedRect(
  box: Box,
  radius: number,
  attributes: string,
): string {
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height + radius * 2}" rx="${radius}" ${attributes} />`;
}
