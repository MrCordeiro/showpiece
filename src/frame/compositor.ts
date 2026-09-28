import sharp, { type OverlayOptions } from "sharp";
import type { FrameTemplate } from "../config/schema.js";
import { type Background, renderBackgroundSvg } from "./background.js";
import { renderBezelSvg } from "./bezel.js";
import { renderCaptionSvg } from "./caption.js";
import { loadFont } from "./font.js";
import {
  CAPTION_TOP,
  getBezelBox,
  getCornerRadius,
  getScreenBox,
} from "./layout.js";
import { renderShadowSvg } from "./shadow.js";

export interface ComposeFrameInput {
  /** Raw PNG bytes straight off the device, any resolution. */
  raw: Buffer;
  template: FrameTemplate;
  background: Background;
  textColor: string;
  caption: string;
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

function roundedRectMask(
  width: number,
  height: number,
  radius: number,
): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" rx="${radius}" fill="#fff" />
</svg>`,
  );
}

/** Crop-to-cover the raw screenshot into `width`×`height`, then clip its corners. */
async function maskedScreenshot(
  raw: Buffer,
  width: number,
  height: number,
  radius: number,
): Promise<Buffer> {
  const fitted = await sharp(raw)
    .resize(width, height, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  return sharp(fitted)
    .composite([
      { input: roundedRectMask(width, height, radius), blend: "dest-in" },
    ])
    .png()
    .toBuffer();
}

/**
 * Composites one framed screenshot. Pure given its inputs — see
 * test/frame-compositor.test.ts's determinism test and
 * test/frame-golden.test.ts for the byte-exact regression suite.
 */
export async function composeFrame(input: ComposeFrameInput): Promise<Buffer> {
  const background = await sharp(
    Buffer.from(renderBackgroundSvg(input.background)),
  )
    .png()
    .toBuffer();

  const screenBox = getScreenBox(input.template);
  const cornerRadius = getCornerRadius(input.template);
  const screenshot = await maskedScreenshot(
    input.raw,
    screenBox.width,
    screenBox.height,
    cornerRadius,
  );

  const layers: OverlayOptions[] = [];

  if (input.template === "minimal") {
    const shadowPng = await sharp(Buffer.from(renderShadowSvg(screenBox)))
      .png()
      .toBuffer();
    layers.push({ input: shadowPng, left: 0, top: 0 });
  } else {
    const bezelBox = getBezelBox(input.template);
    const bezelPng = await sharp(
      Buffer.from(renderBezelSvg(bezelBox, screenBox)),
    )
      .png()
      .toBuffer();
    layers.push({ input: bezelPng, left: bezelBox.x, top: bezelBox.y });
  }

  layers.push({ input: screenshot, left: screenBox.x, top: screenBox.y });

  if (input.caption) {
    const font = loadFont(input.font);
    const captionSvg = renderCaptionSvg(input.caption, input.textColor, font);
    if (captionSvg) {
      const captionPng = await sharp(Buffer.from(captionSvg)).png().toBuffer();
      layers.push({ input: captionPng, left: 0, top: CAPTION_TOP });
    }
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
