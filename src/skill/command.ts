import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VitrineError } from "../util/errors.js";

const SKILL_RELATIVE_PATH = join("skills", "vitrine-flows", "SKILL.md");

/**
 * Locate the packaged skill file, walking up from a starting directory. This
 * has to work from both `dist/cli.js` (published package: `skills/` ships
 * alongside `dist/` at the package root and from `src/` during development
 * (skill lives at the repo root).
 */
export function findPackagedSkill(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, SKILL_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached the filesystem root
    dir = parent;
  }
}

export interface SkillInstallOptions {
  /** Directory `.claude/skills/` is created under. Defaults to process.cwd(). */
  cwd?: string;
  /** Overwrite an already-installed copy. */
  force?: boolean;
}

/**
 * Copy vitrine's bundled Claude Code skill into the consuming repo, at
 * `.claude/skills/vitrine-flows/SKILL.md`, where Claude Code auto-discovers
 * it once committed. Later folds into `vitrine init` (SPEC P1).
 */
export async function runSkillInstall(
  options: SkillInstallOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const here = dirname(fileURLToPath(import.meta.url));
  const source = findPackagedSkill(here);
  if (!source) {
    throw new VitrineError(
      "E_SKILL_NOT_FOUND",
      "Could not locate vitrine's packaged skill (skills/vitrine-flows/SKILL.md missing). This looks like a broken install. Please try reinstalling vitrine.",
    );
  }

  const destDir = join(cwd, ".claude", "skills", "vitrine-flows");
  const dest = join(destDir, "SKILL.md");

  if (existsSync(dest) && !options.force) {
    throw new VitrineError(
      "E_SKILL_ALREADY_INSTALLED",
      `${dest} already exists. Re-run with --force to overwrite it.`,
    );
  }

  await mkdir(destDir, { recursive: true });
  await copyFile(source, dest);
  process.stdout.write(`✓ Installed skill to ${dest}\n`);
  return 0;
}
