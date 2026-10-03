import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config/schema.js";
import { sharedTextSizes } from "../src/frame/caption.js";
import { loadFont } from "../src/frame/font.js";
import { readManifest } from "../src/frame/manifest.js";
import {
  type ListingCheckContext,
  checkListing,
  hasBlockingProblems,
  isExternalEntry,
  playImageProblem,
  resolveListing,
  suggestName,
} from "../src/publish/listing.js";
import { makeTempDir } from "./temp-dir.js";

vi.mock("../src/config/load.js", () => ({ loadConfig: vi.fn() }));

let root: string;
let screenshotsDir: string;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    app: { packageName: "com.example.app" },
    device: {
      avd: "Pixel_7_API_34",
      locale: "en-US",
      devServer: false,
      metroPort: 8081,
    },
    frame: {
      template: "gradient",
      background: ["#1a1a2e", "#16213e"],
      textColor: "#ffffff",
      font: "Inter",
    },
    publish: {
      serviceAccountKeyPath: join(root, "secrets/key.json"),
      track: "listing",
    },
    screenshotsDir,
    diagnosticsDir: join(root, ".showpiece/diagnostics"),
    appearance: "light",
    screens: [
      { id: "home", flow: "home.yaml", caption: "Track everything" },
      { id: "profile", flow: "profile.yaml", caption: "Your data" },
    ],
    ...overrides,
  };
}

async function png(
  width: number,
  height: number,
  channels: 3 | 4 = 3,
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels, background: "#3b82f6" },
  })
    .png()
    .toBuffer();
}

async function context(config: Config): Promise<ListingCheckContext> {
  return {
    config,
    manifest: await readManifest(join(screenshotsDir, "framed")),
    textSizes: sharedTextSizes(config.screens, loadFont(config.frame.font)),
  };
}

async function frameAll(config: Config): Promise<void> {
  const { loadConfig } = await import("../src/config/load.js");
  vi.mocked(loadConfig).mockResolvedValue({
    config,
    configPath: join(root, "showpiece.config.ts"),
    configDir: root,
  });
  const { runFrame } = await import("../src/frame/command.js");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runFrame({});
  vi.mocked(process.stdout.write).mockRestore();
}

beforeEach(async () => {
  vi.clearAllMocks();
  root = makeTempDir("showpiece-listing-");
  screenshotsDir = join(root, ".showpiece/screenshots");
  mkdirSync(join(screenshotsDir, "raw"), { recursive: true });
  mkdirSync(join(screenshotsDir, "framed"), { recursive: true });
  writeFileSync(join(screenshotsDir, "raw", "home.png"), await png(400, 800));
  writeFileSync(
    join(screenshotsDir, "raw", "profile.png"),
    await png(400, 800),
  );
});

describe("isExternalEntry", () => {
  it.each([
    ["./a.png", true],
    ["../a.png", true],
    [".\\a.png", true],
    ["..\\a.png", true],
    ["home.png", false],
    [".hidden.png", false],
  ])("%s -> %s", (entry, expected) => {
    expect(isExternalEntry(entry)).toBe(expected);
  });
});

describe("resolveListing", () => {
  it("uses every screen in config order and appearance when listing is absent", () => {
    const items = resolveListing(makeConfig({ appearance: "dark" }), root);
    expect(items.map((item) => item.entry)).toEqual([
      "home-dark.png",
      "profile-dark.png",
    ]);
    expect(items.map((item) => item.kind)).toEqual(["framed", "framed"]);
  });

  it("keeps the listing order and resolves each kind of entry", () => {
    const config = makeConfig();
    config.publish.listing = ["profile.png", "./m/a.png", "nope.png"];
    const items = resolveListing(config, root);
    expect(items.map((item) => [item.position, item.kind])).toEqual([
      [1, "framed"],
      [2, "external"],
      [3, "unknown"],
    ]);
    expect(items[0]?.path).toBe(join(screenshotsDir, "framed", "profile.png"));
    expect(items[1]?.path).toBe(resolve(root, "m/a.png"));
  });

  it("resolves a backslash path like a slash path", () => {
    const config = makeConfig();
    config.publish.listing = [".\\m\\a.png", "./m/a.png"];
    const [backslash, slash] = resolveListing(config, root);
    expect(backslash?.path).toBe(slash?.path);
  });
});

describe("suggestName", () => {
  it.each([
    ["the closest candidate", "hom.png", "home.png"],
    ["nothing when no candidate is close", "settings.png", undefined],
  ])("suggests %s", (_case, entry, expected) => {
    expect(suggestName(entry, ["home.png", "profile.png"])).toBe(expected);
  });
});

describe("playImageProblem", () => {
  it("accepts a 1080×1920 PNG without alpha", async () => {
    expect(await playImageProblem(await png(1080, 1920))).toBeUndefined();
  });

  it("marks a file over 8 MB too large", async () => {
    expect(
      (await playImageProblem(Buffer.alloc(8 * 1024 * 1024 + 1)))?.status,
    ).toBe("too large");
  });

  it.each([
    ["has an alpha channel", 1080, 1920, 4 as const, /alpha/],
    ["is too small", 200, 400, 3 as const, /320/],
    ["is too narrow", 400, 1000, 3 as const, /twice/],
  ])(
    "marks an image invalid when it %s",
    async (_name, width, height, channels, message) => {
      const problem = await playImageProblem(
        await png(width, height, channels),
      );
      expect(problem?.status).toBe("invalid");
      expect(problem?.detail).toMatch(message);
    },
  );
});

describe("checkListing", () => {
  it("marks every framed entry ok right after frame", async () => {
    const config = makeConfig();
    await frameAll(config);
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items.map((item) => item.status)).toEqual(["ok", "ok"]);
    expect(hasBlockingProblems(check)).toBe(false);
  });

  it("marks an entry stale when another screen's caption changes the shared text size", async () => {
    const config = makeConfig();
    await frameAll(config);
    const longer = makeConfig({
      screens: [
        { id: "home", flow: "home.yaml", caption: "Track everything" },
        {
          id: "profile",
          flow: "profile.yaml",
          caption:
            "A much longer headline that needs a smaller size to fit in two lines",
        },
      ],
    });
    const check = await checkListing(
      resolveListing(longer, root),
      await context(longer),
    );
    expect(check.items[0]?.status).toBe("stale");
    expect(hasBlockingProblems(check)).toBe(false);
  });

  it("marks an entry stale when the framed file changed after frame", async () => {
    const config = makeConfig();
    await frameAll(config);
    writeFileSync(
      join(screenshotsDir, "framed", "home.png"),
      await png(1080, 1920),
    );
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items[0]?.status).toBe("stale");
    expect(check.items[0]?.detail).toMatch(/changed after/);
  });

  it("marks a framed entry stale when the manifest has no entry", async () => {
    const config = makeConfig();
    writeFileSync(
      join(screenshotsDir, "framed", "home.png"),
      await png(1080, 1920),
    );
    writeFileSync(
      join(screenshotsDir, "framed", "profile.png"),
      await png(1080, 1920),
    );
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items.map((item) => item.status)).toEqual(["stale", "stale"]);
  });

  it("marks an unknown name missing and suggests a close name", async () => {
    const config = makeConfig();
    config.publish.listing = ["hom.png", "profile.png"];
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items[0]?.status).toBe("missing");
    expect(check.items[0]?.detail).toContain('Did you mean "home.png"?');
    expect(hasBlockingProblems(check)).toBe(true);
  });

  it("marks a framed entry missing when it is not framed yet", async () => {
    const config = makeConfig();
    config.publish.listing = ["home-dark.png", "home.png"];
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items[0]?.status).toBe("missing");
    expect(check.items[0]?.detail).toContain("showpiece frame");
  });

  it("accepts a valid external image without a manifest entry", async () => {
    mkdirSync(join(root, "m"));
    writeFileSync(join(root, "m", "a.png"), await png(1080, 1920));
    const config = makeConfig();
    config.publish.listing = ["./m/a.png", "./m/a.png"];
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items.map((item) => item.status)).toEqual(["ok", "ok"]);
  });

  it("marks a missing external file missing", async () => {
    const config = makeConfig();
    config.publish.listing = ["./m/none.png", "./m/none.png"];
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items[0]?.status).toBe("missing");
  });

  it("applies the Play image checks to an external file", async () => {
    mkdirSync(join(root, "m"));
    writeFileSync(join(root, "m", "x.png"), await png(1080, 1920, 4));
    const config = makeConfig();
    config.publish.listing = ["./m/x.png", "./m/x.png"];
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.items[0]?.status).toBe("invalid");
    expect(hasBlockingProblems(check)).toBe(true);
  });

  it("reports a listing with fewer than 2 entries", async () => {
    const config = makeConfig();
    config.publish.listing = ["home.png"];
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.listProblems).toHaveLength(1);
    expect(hasBlockingProblems(check)).toBe(true);
  });

  it("tells the user to add publish.listing when the default listing is too long", async () => {
    const screens = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`,
      flow: `s${i}.yaml`,
      caption: "",
    }));
    const config = makeConfig({ screens });
    const check = await checkListing(
      resolveListing(config, root),
      await context(config),
    );
    expect(check.listProblems[0]).toContain("publish.listing");
  });
});
