import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_BYTES,
  assertWithinPlayLimit,
  composeFrame,
} from "../src/frame/compositor.js";

async function tinyRaw(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: "#3b82f6" },
  })
    .png()
    .toBuffer();
}

describe("composeFrame", () => {
  it("always outputs exactly the canvas size, regardless of the raw screenshot's own resolution", async () => {
    const raw = await tinyRaw(400, 800); // deliberately not 9:16
    const buffer = await composeFrame({
      raw,
      template: "gradient",
      background: ["#1a1a2e", "#16213e"],
      textColor: "#ffffff",
      caption: "Track everything",
      font: "Inter",
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
    expect(meta.format).toBe("png");
  });

  it("is deterministic: identical input produces byte-identical output", async () => {
    const raw = await tinyRaw(1080, 2400); // a real modern-phone resolution
    const input = {
      raw,
      template: "minimal" as const,
      background: "#101010",
      textColor: "#ffffff",
      caption: "",
      font: "Inter",
    };
    const [a, b] = await Promise.all([
      composeFrame(input),
      composeFrame(input),
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it("renders without a caption layer when caption is empty", async () => {
    const raw = await tinyRaw(400, 800);
    await expect(
      composeFrame({
        raw,
        template: "solid",
        background: "#101010",
        textColor: "#ffffff",
        caption: "",
        font: "Inter",
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("never produces an alpha channel (Play rejects PNGs with transparency)", async () => {
    const raw = await tinyRaw(400, 800);
    const buffer = await composeFrame({
      raw,
      template: "gradient",
      background: ["#1a1a2e", "#16213e"],
      textColor: "#ffffff",
      caption: "Track everything",
      font: "Inter",
    });
    const meta = await sharp(buffer).metadata();
    expect(meta.hasAlpha).toBe(false);
  });

  it("supports all three templates without throwing", async () => {
    const raw = await tinyRaw(400, 800);
    for (const template of ["gradient", "solid", "minimal"] as const) {
      await expect(
        composeFrame({
          raw,
          template,
          background: template === "solid" ? "#101010" : ["#1a1a2e", "#16213e"],
          textColor: "#ffffff",
          caption: "Your data, your way",
          font: "Inter",
        }),
      ).resolves.toBeInstanceOf(Buffer);
    }
  });
});

describe("assertWithinPlayLimit", () => {
  it("passes for a buffer under the limit", () => {
    expect(() =>
      assertWithinPlayLimit(Buffer.alloc(1024), "home"),
    ).not.toThrow();
  });

  it("throws a clear, per-screen error for a buffer over Play's 8 MB limit", () => {
    const oversized = Buffer.alloc(MAX_OUTPUT_BYTES + 1);
    expect(() => assertWithinPlayLimit(oversized, "home-dark")).toThrow(
      /"home-dark".*exceeds Play's 8 MB/,
    );
  });
});
