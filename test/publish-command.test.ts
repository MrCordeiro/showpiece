import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Config } from "../src/config/schema.js";
import type { PlayClient } from "../src/publish/play.js";
import { VitrineError } from "../src/util/errors.js";
import { makeTempDir } from "./temp-dir.js";

vi.mock("../src/config/load.js", () => ({ loadConfig: vi.fn() }));

let root: string;
let output: string;
let framedTemplate: string;

function makeConfig(listing?: string[]): Config {
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
      listing,
    },
    screenshotsDir: join(root, ".vitrine/screenshots"),
    diagnosticsDir: join(root, ".vitrine/diagnostics"),
    appearance: "light",
    screens: [
      { id: "home", flow: "home.yaml", caption: "Track everything" },
      { id: "profile", flow: "profile.yaml", caption: "Your data" },
    ],
  };
}

async function useConfig(config: Config): Promise<void> {
  const { loadConfig } = await import("../src/config/load.js");
  vi.mocked(loadConfig).mockResolvedValue({
    config,
    configPath: join(root, "vitrine.config.ts"),
    configDir: root,
  });
}

function writeKey(): void {
  mkdirSync(join(root, "secrets"), { recursive: true });
  writeFileSync(
    join(root, "secrets/key.json"),
    JSON.stringify({
      type: "service_account",
      client_email: "vitrine@p.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----",
    }),
  );
}

function fakeClient(overrides: Partial<PlayClient> = {}) {
  const calls: string[] = [];
  let count = 3;
  const client: PlayClient = {
    insertEdit: vi.fn(async () => {
      calls.push("insert");
      return "edit-1";
    }),
    hasListing: vi.fn(async () => {
      calls.push("listing");
      return true;
    }),
    countScreenshots: vi.fn(async () => {
      calls.push("count");
      return count;
    }),
    deleteAllScreenshots: vi.fn(async () => {
      calls.push("deleteall");
      count = 0;
    }),
    uploadScreenshot: vi.fn(async (_editId, _language, path) => {
      calls.push(`upload ${basename(path)}`);
      count += 1;
    }),
    validateEdit: vi.fn(async () => {
      calls.push("validate");
    }),
    commitEdit: vi.fn(async () => {
      calls.push("commit");
    }),
    deleteEdit: vi.fn(async () => {
      calls.push("delete");
    }),
    ...overrides,
  };
  return { client, calls, createClient: vi.fn(() => client) };
}

// Framing loads sharp and fonts, so it runs once. Each test gets a copy, and
// the copied manifest stays valid because it records hashes, not paths.
beforeAll(async () => {
  root = makeTempDir("vitrine-publish-template-");
  const config = makeConfig();
  const raw = await sharp({
    create: { width: 400, height: 800, channels: 3, background: "#3b82f6" },
  })
    .png()
    .toBuffer();
  mkdirSync(join(config.screenshotsDir, "raw"), { recursive: true });
  writeFileSync(join(config.screenshotsDir, "raw", "home.png"), raw);
  writeFileSync(join(config.screenshotsDir, "raw", "profile.png"), raw);
  await useConfig(config);
  const { runFrame } = await import("../src/frame/command.js");
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  await runFrame({});
  stdout.mockRestore();
  framedTemplate = config.screenshotsDir;
});

beforeEach(() => {
  vi.clearAllMocks();
  root = makeTempDir("vitrine-publish-");
  cpSync(framedTemplate, join(root, ".vitrine/screenshots"), {
    recursive: true,
  });
  output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runPublish", () => {
  it("replaces the screenshots in listing order and commits with --yes", async () => {
    await useConfig(makeConfig(["profile.png", "home.png"]));
    writeKey();
    const fake = fakeClient();
    const { runPublish } = await import("../src/publish/command.js");

    const exitCode = await runPublish(
      { yes: true },
      { createClient: fake.createClient },
    );

    expect(exitCode).toBe(0);
    expect(fake.calls).toEqual([
      "insert",
      "listing",
      "count",
      "deleteall",
      "upload profile.png",
      "upload home.png",
      "count",
      "validate",
      "commit",
    ]);
    expect(output).toContain("Store listing (2 screenshots)");
    expect(output).toContain(
      "https://play.google.com/store/apps/details?id=com.example.app",
    );
  });

  it("validates and deletes the edit on --dry-run without a question", async () => {
    await useConfig(makeConfig());
    writeKey();
    const fake = fakeClient();
    const confirm = vi.fn();
    const { runPublish } = await import("../src/publish/command.js");

    const exitCode = await runPublish(
      { dryRun: true },
      { createClient: fake.createClient, confirm, isInteractive: false },
    );

    expect(exitCode).toBe(0);
    expect(fake.calls.at(-2)).toBe("validate");
    expect(fake.calls.at(-1)).toBe("delete");
    expect(fake.calls).not.toContain("commit");
    expect(confirm).not.toHaveBeenCalled();
    expect(output).toContain("replace the 3 current screenshots");
  });

  it("makes no API call when the user declines", async () => {
    await useConfig(makeConfig());
    writeKey();
    const fake = fakeClient();
    const { runPublish } = await import("../src/publish/command.js");

    const exitCode = await runPublish(
      {},
      {
        createClient: fake.createClient,
        confirm: async () => false,
        isInteractive: true,
      },
    );

    expect(exitCode).toBe(1);
    expect(fake.createClient).not.toHaveBeenCalled();
    expect(output).toContain("Nothing was sent to Play");
  });

  it("asks with the count and the package name, then commits on yes", async () => {
    await useConfig(makeConfig());
    writeKey();
    const fake = fakeClient();
    const confirm = vi.fn(async () => true);
    const { runPublish } = await import("../src/publish/command.js");

    await runPublish(
      {},
      { createClient: fake.createClient, confirm, isInteractive: true },
    );

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Commit 2 screenshots to com.example.app?"),
    );
    expect(fake.calls.at(-1)).toBe("commit");
  });

  it("fails without a TTY and without --yes", async () => {
    await useConfig(makeConfig());
    writeKey();
    const fake = fakeClient();
    const { runPublish } = await import("../src/publish/command.js");

    await expect(
      runPublish({}, { createClient: fake.createClient, isInteractive: false }),
    ).rejects.toMatchObject({ code: "E_PUBLISH_CONFIRM_REQUIRED" });
    expect(fake.createClient).not.toHaveBeenCalled();
  });

  it("stops before the key and the API when an entry is blocking", async () => {
    await useConfig(makeConfig(["hom.png", "profile.png"]));
    const fake = fakeClient();
    const { runPublish } = await import("../src/publish/command.js");

    const exitCode = await runPublish(
      { yes: true },
      { createClient: fake.createClient },
    );

    expect(exitCode).toBe(1);
    expect(output).toContain('Did you mean "home.png"?');
    expect(fake.createClient).not.toHaveBeenCalled();
  });

  it.each<
    [string, () => Partial<PlayClient>, string, keyof PlayClient | undefined]
  >([
    [
      "the listing has no such language",
      () => ({ hasListing: vi.fn(async () => false) }),
      "E_PUBLISH_LOCALE",
      "deleteAllScreenshots",
    ],
    [
      "an upload fails",
      () => ({
        uploadScreenshot: vi.fn(async () => {
          throw new VitrineError("E_PUBLISH_API", "upload failed");
        }),
      }),
      "E_PUBLISH_API",
      "commitEdit",
    ],
    [
      "Play has a different count after the upload",
      () => ({ countScreenshots: vi.fn(async () => 0) }),
      "E_PUBLISH_UPLOAD_COUNT",
      "commitEdit",
    ],
    [
      "the commit fails",
      () => ({
        commitEdit: vi.fn(async () => {
          throw new VitrineError("E_PUBLISH_IN_REVIEW", "in review");
        }),
      }),
      "E_PUBLISH_IN_REVIEW",
      undefined,
    ],
  ])(
    "deletes the edit and reports the error when %s",
    async (_case, overrides, code, skippedStep) => {
      await useConfig(makeConfig());
      writeKey();
      const fake = fakeClient(overrides());
      const { runPublish } = await import("../src/publish/command.js");

      await expect(
        runPublish({ yes: true }, { createClient: fake.createClient }),
      ).rejects.toMatchObject({ code });
      expect(fake.client.deleteEdit).toHaveBeenCalledWith("edit-1");
      if (skippedStep) {
        expect(fake.client[skippedStep]).not.toHaveBeenCalled();
      }
    },
  );

  it("still reports the first error when the edit cannot be deleted", async () => {
    await useConfig(makeConfig());
    writeKey();
    const failure = new Error("validate failed");
    const fake = fakeClient({
      validateEdit: vi.fn(async () => {
        throw failure;
      }),
      deleteEdit: vi.fn(async () => {
        throw new Error("delete failed");
      }),
    });
    const { runPublish } = await import("../src/publish/command.js");

    await expect(
      runPublish({ yes: true }, { createClient: fake.createClient }),
    ).rejects.toBe(failure);
    expect(output).toContain("edit-1");
  });
});
