import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inviteStatePath, maybeShowInvite } from "../src/util/invite.js";
import { makeTempDir } from "./temp-dir.js";

const URL = "https://example.com/book";

function setup(overrides: Partial<Parameters<typeof maybeShowInvite>[0]> = {}) {
  const dir = makeTempDir("showpiece-invite-");
  const lines: string[] = [];
  const options = {
    env: {},
    isTTY: true,
    statePath: join(dir, "showpiece", "state.json"),
    url: URL,
    write: (line: string) => lines.push(line),
    ...overrides,
  };
  return { options, lines };
}

describe("maybeShowInvite", () => {
  it("shows the invite once per machine", async () => {
    const { options, lines } = setup();

    expect(await maybeShowInvite(options)).toBe(true);
    expect(await maybeShowInvite(options)).toBe(false);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(URL);
  });

  it.each([
    [{}, true],
    [{ NO_COLOR: "1" }, false],
  ])("uses colour codes only without NO_COLOR (%o)", async (env, coloured) => {
    const { options, lines } = setup({ env });

    await maybeShowInvite(options);

    expect(lines.join("").includes("\x1b[")).toBe(coloured);
  });

  it.each([
    ["CI is set", { env: { CI: "true" } }],
    ["SHOWPIECE_NO_INVITE=1", { env: { SHOWPIECE_NO_INVITE: "1" } }],
    ["stdout is not a TTY", { isTTY: false }],
    ["no booking link is configured", { url: "" }],
  ])("shows nothing and records nothing when %s", async (_, overrides) => {
    const { options, lines } = setup(overrides);

    expect(await maybeShowInvite(options)).toBe(false);

    expect(lines).toEqual([]);
    expect(existsSync(options.statePath)).toBe(false);
  });

  it("shows nothing when the state file cannot be written", async () => {
    const dir = makeTempDir("showpiece-invite-");
    // A file where the state folder must be makes mkdir fail.
    writeFileSync(join(dir, "showpiece"), "");
    const { options, lines } = setup({
      statePath: join(dir, "showpiece", "state.json"),
    });

    expect(await maybeShowInvite(options)).toBe(false);
    expect(lines).toEqual([]);
  });

  it("shows the invite once when two runs start together", async () => {
    const { options, lines } = setup();

    const shown = await Promise.all([
      maybeShowInvite(options),
      maybeShowInvite(options),
    ]);

    expect(shown.filter(Boolean)).toHaveLength(1);
    expect(lines).toHaveLength(1);
  });

  it("treats any existing state file as shown, also a corrupt one", async () => {
    const { options, lines } = setup();
    mkdirSync(join(options.statePath, ".."), { recursive: true });
    writeFileSync(options.statePath, "{not json");

    expect(await maybeShowInvite(options)).toBe(false);
    expect(lines).toEqual([]);
  });

  it("does not fail the command when the output cannot be written", async () => {
    const { options } = setup({
      write: () => {
        throw new Error("EPIPE");
      },
    });

    await expect(maybeShowInvite(options)).resolves.toBe(false);
  });
});

describe("inviteStatePath", () => {
  it.each([
    [{ XDG_CONFIG_HOME: "/xdg" }, join("/xdg", "showpiece", "state.json")],
    [{}, join("/home/u", ".config", "showpiece", "state.json")],
  ])("uses XDG_CONFIG_HOME, else ~/.config (%o)", (env, expected) => {
    expect(inviteStatePath(env, "/home/u")).toBe(expected);
  });
});
