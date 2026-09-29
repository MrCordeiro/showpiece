import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { configSchema } from "../src/config/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

const base = {
  app: { packageName: "com.example.myapp" },
  device: { avd: "Pixel_7_API_34" },
  frame: { background: ["#1a1a2e", "#16213e"] as [string, string] },
  publish: { serviceAccountKeyPath: "./secrets/key.json" },
  screens: [{ id: "home", flow: "flows/home.yaml" }],
};

describe("configSchema", () => {
  it("applies defaults for omitted fields", () => {
    const parsed = configSchema.parse(base);
    expect(parsed.device.locale).toBe("en-US");
    expect(parsed.device.devServer).toBe(true);
    expect(parsed.device.metroPort).toBe(8081);
    expect(parsed.frame.template).toBe("gradient");
    expect(parsed.frame.textColor).toBe("#ffffff");
    expect(parsed.frame.font).toBe("Inter");
    expect(parsed.publish.track).toBe("listing");
    expect(parsed.screens[0]?.caption).toBe("");
    expect(parsed.screenshotsDir).toBe(".vitrine/screenshots");
    expect(parsed.diagnosticsDir).toBe(".vitrine/diagnostics");
    expect(parsed.appearance).toBe("light");
  });

  it("accepts a solid background color", () => {
    const parsed = configSchema.parse({
      ...base,
      frame: { background: "#101010" },
    });
    expect(parsed.frame.background).toBe("#101010");
  });

  it("rejects a missing packageName", () => {
    const result = configSchema.safeParse({ ...base, app: {} });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual([
      "app",
      "packageName",
    ]);
  });

  it("rejects an unknown template", () => {
    const result = configSchema.safeParse({
      ...base,
      frame: { template: "neon", background: "#101010" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a dark appearance", () => {
    const parsed = configSchema.parse({ ...base, appearance: "dark" });
    expect(parsed.appearance).toBe("dark");
  });

  it("rejects an unknown appearance", () => {
    const result = configSchema.safeParse({ ...base, appearance: "sepia" });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual([
      "appearance",
    ]);
  });

  it("rejects a malformed background color", () => {
    const result = configSchema.safeParse({
      ...base,
      frame: { background: "blue" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty screens array", () => {
    const result = configSchema.safeParse({ ...base, screens: [] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate screen ids", () => {
    const result = configSchema.safeParse({
      ...base,
      screens: [
        { id: "home", flow: "a.yaml" },
        { id: "home", flow: "b.yaml" },
      ],
    });
    expect(result.success).toBe(false);
    expect(
      result.success ? "" : result.error.issues.map((i) => i.message).join(),
    ).toMatch(/duplicate screen id "home"/);
  });

  it("rejects a gradient background with the solid template", () => {
    const result = configSchema.safeParse({
      ...base,
      frame: { template: "solid", background: ["#101010", "#202020"] },
    });
    expect(result.success).toBe(false);
    expect(
      result.success ? "" : result.error.issues.map((i) => i.message).join(),
    ).toMatch(/template "solid" requires a single background color/);
  });

  it("rejects an unknown font", () => {
    const result = configSchema.safeParse({
      ...base,
      frame: { background: "#101010", font: "Comic Sans" },
    });
    expect(result.success).toBe(false);
  });
});

describe("loadConfig", () => {
  it("loads and validates a JSON config, resolving paths to absolute", async () => {
    const { config, configPath } = await loadConfig(
      join(fixtures, "valid.config.json"),
    );
    expect(config.app.packageName).toBe("com.example.myapp");
    expect(config.device.locale).toBe("en-US"); // default applied

    const [home] = config.screens;
    expect(home?.flow).toBe(join(fixtures, "flows/home.yaml"));
    expect(isAbsolute(home?.flow ?? "")).toBe(true);

    const { apkPath } = config.app;
    expect(apkPath && isAbsolute(apkPath)).toBeTruthy();
    expect(isAbsolute(config.publish.serviceAccountKeyPath)).toBe(true);
    expect(configPath).toBe(join(fixtures, "valid.config.json"));

    // screenshotsDir/diagnosticsDir default to a namespace under .vitrine and
    // resolve against the config file's directory, not process.cwd().
    expect(config.screenshotsDir).toBe(join(fixtures, ".vitrine/screenshots"));
    expect(config.diagnosticsDir).toBe(join(fixtures, ".vitrine/diagnostics"));
  });

  it("resolves an overridden screenshotsDir against configDir, not cwd", async () => {
    const cwdBefore = process.cwd();
    process.chdir(here); // deliberately different from `fixtures`
    try {
      const { config } = await loadConfig(join(fixtures, "valid.config.json"));
      expect(config.screenshotsDir).not.toBe(
        resolve(cwdBefore, ".vitrine/screenshots"),
      );
      expect(config.screenshotsDir).toBe(
        join(fixtures, ".vitrine/screenshots"),
      );
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it("loads a TypeScript config via jiti", async () => {
    const { config } = await loadConfig(join(fixtures, "valid.config.ts"));
    expect(config.app.packageName).toBe("com.example.tsapp");
    expect(config.frame.template).toBe("solid");
    expect(config.screens[0]?.caption).toBe("TS caption");
  });

  it("throws a readable error for a missing config file", async () => {
    await expect(
      loadConfig(join(fixtures, "does-not-exist.ts")),
    ).rejects.toThrow(/Config file not found/);
  });
});
