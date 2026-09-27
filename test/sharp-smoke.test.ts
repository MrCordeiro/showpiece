import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("sharp (native binary)", () => {
  it("renders a blank PNG", async () => {
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 4, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
