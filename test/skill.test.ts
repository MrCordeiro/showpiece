import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findPackagedSkill, runSkillInstall } from "../src/skill/command.js";
import { makeTempDir } from "./temp-dir.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here); // test/ -> repo root

describe("findPackagedSkill", () => {
  it("finds the skill by walking up from src/skill/", () => {
    const srcSkillDir = join(repoRoot, "src", "skill");
    expect(findPackagedSkill(srcSkillDir)).toBe(
      join(repoRoot, "skills", "vitrine-flows", "SKILL.md"),
    );
  });

  it("finds the skill by walking up from a simulated dist/", () => {
    // Mirrors the published layout: dist/cli.js sits next to skills/ at the
    // package root.
    const distDir = join(repoRoot, "dist");
    expect(findPackagedSkill(distDir)).toBe(
      join(repoRoot, "skills", "vitrine-flows", "SKILL.md"),
    );
  });

  it("returns undefined when no ancestor has skills/vitrine-flows/SKILL.md", () => {
    // A hardcoded drive root ("C:/") isn't a reliable "no such ancestor"
    // sentinel cross-platform: on POSIX it isn't absolute, so `dirname`
    // resolves it relative to cwd instead of stopping at a filesystem root.
    // A real, isolated temp directory has a genuine, skill-free ancestor
    // chain on every platform.
    const isolated = makeTempDir("vitrine-no-skill-");
    expect(findPackagedSkill(isolated)).toBeUndefined();
  });
});

// runSkillInstall is a tiny, self-contained file-copy — real I/O against a
// throwaway temp dir is simpler and more faithful than mocking node:fs here.
describe("runSkillInstall", () => {
  it("copies the skill to .claude/skills/vitrine-flows/SKILL.md", async () => {
    const cwd = makeTempDir("vitrine-skill-");

    await runSkillInstall({ cwd });

    const dest = join(cwd, ".claude", "skills", "vitrine-flows", "SKILL.md");
    const content = await readFile(dest, "utf8");
    expect(content).toContain("name: vitrine-flows");
  });

  it("refuses to overwrite an existing install without --force", async () => {
    const cwd = makeTempDir("vitrine-skill-");
    await runSkillInstall({ cwd });

    await expect(runSkillInstall({ cwd })).rejects.toThrow(/already exists/);
  });

  it("overwrites when --force is passed", async () => {
    const cwd = makeTempDir("vitrine-skill-");
    await runSkillInstall({ cwd });

    await expect(runSkillInstall({ cwd, force: true })).resolves.toBe(0);
  });
});
