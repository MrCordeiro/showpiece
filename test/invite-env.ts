import { join } from "node:path";
import { vi } from "vitest";
import { makeTempDir } from "./temp-dir.js";

export const INVITE_MARK = "Thank you for trying showpiece!";

/**
 * Turns the invite on for one test. vitest.config.ts turns it off for every
 * other test, and CI sets `CI`, so both are cleared here. The state file is in
 * a temp folder, never in the real ~/.config.
 */
export function enableInvite(): { stateFile: string; restore: () => void } {
  const configHome = makeTempDir("showpiece-config-");
  vi.stubEnv("XDG_CONFIG_HOME", configHome);
  vi.stubEnv("SHOWPIECE_NO_INVITE", "");
  vi.stubEnv("CI", "");
  const isTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  return {
    stateFile: join(configHome, "showpiece", "state.json"),
    restore: () => {
      process.stdout.isTTY = isTTY;
      vi.unstubAllEnvs();
    },
  };
}
