import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// An empty link turns the invite off.
export const INVITE_URL = "";
export const INVITE_TEXT =
  "Building showpiece alone. Would you talk to me for 20 min about how you make store screenshots?";

export interface InviteOptions {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  statePath?: string;
  url?: string;
  write?: (line: string) => void;
}

export function inviteStatePath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configHome, "showpiece", "state.json");
}

/**
 * Prints the interview invite once per machine, after a successful run.
 * It sends no data. Any error means no invite, so it never fails a command.
 */
export async function maybeShowInvite(
  options: InviteOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const url = options.url ?? INVITE_URL;
  if (!url || !isTTY || env.CI || env.SHOWPIECE_NO_INVITE === "1") {
    return false;
  }

  const statePath = options.statePath ?? inviteStatePath(env);
  try {
    const state = await readState(statePath);
    if (state.inviteShown) return false;
    // Record before printing, so an unwritable state file cannot show the invite on every run.
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(
      statePath,
      `${JSON.stringify({ ...state, inviteShown: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch {
    return false;
  }

  const write = options.write ?? ((line: string) => process.stdout.write(line));
  write(`\n${INVITE_TEXT} ${url}\n`);
  return true;
}

async function readState(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
