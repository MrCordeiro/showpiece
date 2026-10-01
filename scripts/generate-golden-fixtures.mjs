#!/usr/bin/env node
// Regenerates test/fixtures/frame/{raw,expected}. Run this manually after an
// intentional change to the frame templates, then review the resulting diff
// before committing — that review IS what makes these images "golden."
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixturesDir = join(root, "test", "fixtures", "frame");

/** A synthetic "app screenshot" — deterministic, and a real modern-phone resolution (not 9:16), so the fixture also exercises the compositor's crop-to-cover behavior. */
async function buildSampleRaw() {
  const width = 1080;
  const height = 2280;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#f2f2f2" />
  <rect width="100%" height="200" fill="#3b82f6" />
  <rect x="60" y="280" width="960" height="140" rx="16" fill="#e2e8f0" />
  <rect x="60" y="460" width="960" height="140" rx="16" fill="#e2e8f0" />
  <rect x="60" y="640" width="960" height="140" rx="16" fill="#e2e8f0" />
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function cleanDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function main() {
  const expectedDir = join(fixturesDir, "expected");
  await cleanDir(expectedDir);
  await mkdir(join(fixturesDir, "raw"), { recursive: true });

  const raw = await buildSampleRaw();
  await writeFile(join(fixturesDir, "raw", "sample.png"), raw);

  const jiti = createJiti(import.meta.url);
  const { composeFrame } = await jiti.import(
    join(root, "src", "frame", "compositor.ts"),
  );
  const { GOLDEN_CASES } = await jiti.import(join(fixturesDir, "cases.ts"));

  for (const { name, ...input } of GOLDEN_CASES) {
    const framed = await composeFrame({ raw, ...input });
    await writeFile(join(expectedDir, `${name}.png`), framed);
  }

  process.stdout.write(`Regenerated golden fixtures in ${fixturesDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
