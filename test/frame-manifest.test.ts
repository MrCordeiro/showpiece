import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config, ScreenConfig } from "../src/config/schema.js";
import {
  type FrameInputs,
  MANIFEST_FILE,
  frameInputsFor,
  inputHash,
  readManifest,
  writeManifest,
} from "../src/frame/manifest.js";
import { makeTempDir } from "./temp-dir.js";

const frame: Config["frame"] = {
  template: "gradient",
  background: ["#1a1a2e", "#16213e"],
  textColor: "#ffffff",
  font: "Inter",
};
const sizes = { headlineSize: 100, subtitleSize: 40 };
const sharedSizes = { ...sizes, soloHeadlineSize: 110 };
const raw = Buffer.from("raw-bytes");

function inputs(overrides: Partial<FrameInputs> = {}): FrameInputs {
  return {
    template: "gradient",
    background: "#000000",
    textColor: "#ffffff",
    caption: "Track everything",
    subtitle: undefined,
    font: "Inter",
    ...sizes,
    ...overrides,
  };
}

describe("frameInputsFor", () => {
  it("uses the screen's background and text colour over the frame defaults", () => {
    const screen: ScreenConfig = {
      id: "home",
      flow: "home.yaml",
      caption: "Hi",
      background: "#3ccf91",
      textColor: "#1a1a1a",
    };
    expect(frameInputsFor(screen, frame, sharedSizes)).toEqual({
      template: "gradient",
      background: "#3ccf91",
      textColor: "#1a1a1a",
      caption: "Hi",
      subtitle: undefined,
      font: "Inter",
      headlineSize: 110,
      subtitleSize: 40,
    });
  });

  it.each([
    ["without a subtitle gets the solo size", undefined, 110],
    ["with a subtitle gets the shared size", "Sub", 100],
  ])("gives a screen %s", (_case, subtitle, headlineSize) => {
    const screen: ScreenConfig = {
      id: "home",
      flow: "home.yaml",
      caption: "Hi",
      subtitle,
    };
    expect(frameInputsFor(screen, frame, sharedSizes).headlineSize).toBe(
      headlineSize,
    );
  });

  it("falls back to the frame defaults", () => {
    const screen: ScreenConfig = { id: "home", flow: "home.yaml", caption: "" };
    const result = frameInputsFor(screen, frame, sharedSizes);
    expect(result.background).toEqual(["#1a1a2e", "#16213e"]);
    expect(result.textColor).toBe("#ffffff");
  });
});

describe("inputHash", () => {
  it("is the same for the same inputs", () => {
    expect(inputHash(raw, inputs())).toBe(inputHash(raw, inputs()));
  });

  it.each<[string, Partial<FrameInputs>]>([
    ["caption", { caption: "Other" }],
    ["subtitle", { subtitle: "Sub" }],
    ["background", { background: "#111111" }],
    ["text colour", { textColor: "#000000" }],
    ["template", { template: "minimal" }],
    ["font", { font: "Metropolis" }],
    ["headline size", { headlineSize: 90 }],
    ["subtitle size", { subtitleSize: 30 }],
  ])("changes when the %s changes", (_name, change) => {
    expect(inputHash(raw, inputs(change))).not.toBe(inputHash(raw, inputs()));
  });

  it("changes when the raw bytes change", () => {
    expect(inputHash(Buffer.from("other"), inputs())).not.toBe(
      inputHash(raw, inputs()),
    );
  });
});

describe("readManifest", () => {
  const empty = { schemaVersion: 1, images: {} };

  it.each<[string, string | undefined]>([
    ["the file is missing", undefined],
    ["the file is not JSON", "{not json"],
    ["the schema version is unknown", '{"schemaVersion":2,"images":{}}'],
    ["images is an array", '{"schemaVersion":1,"images":[]}'],
  ])("returns an empty manifest when %s", async (_case, content) => {
    const dir = makeTempDir("vitrine-manifest-");
    if (content !== undefined) writeFileSync(join(dir, MANIFEST_FILE), content);
    expect(await readManifest(dir)).toEqual(empty);
  });

  it("reads back what writeManifest wrote", async () => {
    const dir = makeTempDir("vitrine-manifest-");
    const manifest = {
      schemaVersion: 1 as const,
      images: { home: { inputHash: "a", outputHash: "b" } },
    };
    await writeManifest(dir, manifest);
    expect(await readManifest(dir)).toEqual(manifest);
  });
});
