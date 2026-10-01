import sharp, { type OverlayOptions } from "sharp";
import type { FrameTemplate } from "../config/schema.js";
import { type Background, renderBackgroundSvg } from "./background.js";
import { bezelStyleFor, renderBezelSvg } from "./bezel.js";
import { type TextSizes, renderTextSvg } from "./caption.js";
import { loadFont } from "./font.js";
import {
  SCREEN_CORNER_RADIUS,
  getBezelBox,
  getScreenBox,
  topRoundedRect,
} from "./layout.js";
import { renderShadowSvg } from "./shadow.js";

export interface ComposeFrameInput extends TextSizes {
  /** Raw PNG bytes straight off the device, any resolution. */
  raw: Buffer;
  template: FrameTemplate;
  background: Background;
  textColor: string;
  caption: string;
  subtitle?: string;
  /** Bundled font name — see src/frame/font.ts. */
  font: string;
}

/** Play's per-image size limit for listing screenshots. */
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export function assertWithinPlayLimit(buffer: Buffer, id: string): void {
  if (buffer.length > MAX_OUTPUT_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Framed image "${id}" is ${mb} MB, which exceeds Play's 8 MB per-image limit.`,
    );
  }
}

function topRoundedMask(width: number, height: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${topRoundedRect({ x: 0, y: 0, width, height }, SCREEN_CORNER_RADIUS, 'fill="#fff"')}
</svg>`,
  );
}

/**
 * Scales the raw screenshot to the screen width and keeps its top, because
 * the device continues below the canvas. A raw wider than the screen box's
 * aspect ratio is scaled to the box height and loses its sides instead.
 */
async function maskedScreenshot(
  raw: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const fitted = await sharp(raw)
    .resize(width, height, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  return sharp(fitted)
    .composite([{ input: topRoundedMask(width, height), blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Composites one framed screenshot. Pure given its inputs — see
 * test/frame-compositor.test.ts's determinism test and
 * test/frame-golden.test.ts for the byte-exact regression suite.
 */
export async function composeFrame(input: ComposeFrameInput): Promise<Buffer> {
  const background = await svgToPng(renderBackgroundSvg(input.background));

  const screenBox = getScreenBox();
  const screenshot = await maskedScreenshot(
    input.raw,
    screenBox.width,
    screenBox.height,
  );
  const screenshotLayer: OverlayOptions = {
    input: screenshot,
    left: screenBox.x,
    top: screenBox.y,
  };

  const layers: OverlayOptions[] = [];
  if (input.template === "minimal") {
    const shadow = await svgToPng(renderShadowSvg(screenBox));
    layers.push({ input: shadow, left: 0, top: 0 }, screenshotLayer);
  } else {
    const bezel = await svgToPng(
      renderBezelSvg(getBezelBox(), screenBox, bezelStyleFor(input.background)),
    );
    // The bezel goes above the screenshot, so the bezel's antialiased
    // opening edge covers the screenshot's own corner edge.
    layers.push(screenshotLayer, { input: bezel, left: 0, top: 0 });
  }

  const textSvg = renderTextSvg({
    caption: input.caption,
    subtitle: input.subtitle ?? "",
    textColor: input.textColor,
    font: loadFont(input.font),
    headlineSize: input.headlineSize,
    subtitleSize: input.subtitleSize,
  });
  if (textSvg) {
    layers.push({ input: await svgToPng(textSvg), left: 0, top: 0 });
  }

  // .flatten() must run in a separate sharp() call after compositing:
  // sharp's operations run in a fixed pipeline order rather than call
  // order, and .composite() re-adds an alpha channel to the base image
  // even when chained after .flatten() — verified empirically (hasAlpha
  // stayed true when flatten was chained before .toBuffer() in the same
  // pipeline as .composite()).
  const composited = await sharp(background).composite(layers).png().toBuffer();
  return sharp(composited).flatten().png({ compressionLevel: 9 }).toBuffer();
}
