import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const INVITE_URL =
  "https://cal.com/fernando-cordeiro/how-you-make-store-screenshots-showpiece";

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
    await mkdir(dirname(statePath), { recursive: true });
    // "wx" fails when the file exists, so only one run can create it, also
    // when two commands start together. The file is created before the note
    // is printed, so an unwritable state file cannot show the note on every run.
    await writeFile(
      statePath,
      `${JSON.stringify({ inviteShown: new Date().toISOString() }, null, 2)}
`,
      { flag: "wx" },
    );
    const write =
      options.write ?? ((text: string) => process.stdout.write(text));
    write(formatInvite(url, !env.NO_COLOR));
  } catch {
    return false;
  }
  return true;
}

// See https://no-color.org: any non-empty NO_COLOR value turns colour off.
function formatInvite(url: string, colour: boolean): string {
  const style = (code: string, text: string) =>
    colour ? `\x1b[${code}m${text}\x1b[0m` : text;
  return [
    "",
    `  ${style("1;31", "♥ Thank you for trying showpiece!")} ٩(ˊᗜˋ*)و`,
    "",
    `  ${style("1", "Want to help shape the roadmap?")}`,
    "  Tell me how you make store screenshots, in a 15-min call:",
    `  → ${style("4;36", url)}`,
    "",
    `  ${style("2", "You see this note once. SHOWPIECE_NO_INVITE=1 turns it off.")}`,
    "",
  ].join("\n");
}
