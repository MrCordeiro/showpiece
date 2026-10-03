import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { createJiti } from "jiti";
import type { z } from "zod";
import { ShowpieceError } from "../util/errors.js";
import { type Config, configSchema } from "./schema.js";

const DEFAULT_BASENAMES = [
  "showpiece.config.ts",
  "showpiece.config.js",
  "showpiece.config.mjs",
  "showpiece.config.json",
];

export interface LoadedConfig {
  config: Config;
  /** Absolute path to the resolved config file. */
  configPath: string;
  /** Directory of the config file; all relative paths resolve against it. */
  configDir: string;
}

/**
 * Locate, load, and validate a showpiece config.
 *
 * @param explicitPath  value of `--config`, if provided.
 * @param cwd           directory to search when no explicit path is given.
 */
export async function loadConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<LoadedConfig> {
  const configPath = resolveConfigPath(explicitPath, cwd);
  const raw = await importConfigModule(configPath);

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ShowpieceError(
      "E_CONFIG_INVALID",
      formatConfigError(parsed.error, configPath),
    );
  }

  const configDir = dirname(configPath);
  return {
    config: withResolvedPaths(parsed.data, configDir),
    configPath,
    configDir,
  };
}

function resolveConfigPath(
  explicitPath: string | undefined,
  cwd: string,
): string {
  if (explicitPath) {
    const abs = isAbsolute(explicitPath)
      ? explicitPath
      : resolve(cwd, explicitPath);
    if (!existsSync(abs)) {
      throw new ShowpieceError(
        "E_CONFIG_NOT_FOUND",
        `Config file not found: ${abs}`,
      );
    }
    return abs;
  }

  for (const basename of DEFAULT_BASENAMES) {
    const candidate = resolve(cwd, basename);
    if (existsSync(candidate)) return candidate;
  }

  throw new ShowpieceError(
    "E_CONFIG_NOT_FOUND",
    `No config file found in ${cwd}. Expected one of: ${DEFAULT_BASENAMES.join(
      ", ",
    )} (or pass --config <path>).`,
  );
}

async function importConfigModule(configPath: string): Promise<unknown> {
  if (configPath.endsWith(".json")) {
    return JSON.parse(await readFile(configPath, "utf8"));
  }

  // jiti loads TS/ESM in-process without a separate build step.
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const mod = await jiti.import<unknown>(configPath, { default: true });
  return mod;
}

/** Resolve every filesystem path in the config relative to the config file. */
function withResolvedPaths(config: Config, configDir: string): Config {
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(configDir, p));
  return {
    ...config,
    screenshotsDir: abs(config.screenshotsDir),
    diagnosticsDir: abs(config.diagnosticsDir),
    app: {
      ...config.app,
      apkPath: config.app.apkPath ? abs(config.app.apkPath) : undefined,
    },
    publish: {
      ...config.publish,
      serviceAccountKeyPath: abs(config.publish.serviceAccountKeyPath),
    },
    screens: config.screens.map((screen) => ({
      ...screen,
      flow: abs(screen.flow),
    })),
  };
}

/** Turn a ZodError into a readable, multi-line message. */
export function formatConfigError(
  error: z.ZodError,
  configPath: string,
): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `  • ${path}: ${issue.message}`;
  });
  return `Invalid config at ${configPath}:\n${lines.join("\n")}`;
}
