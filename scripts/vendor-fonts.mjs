#!/usr/bin/env node
// One-off vendoring step: copies the static weights showpiece needs out of
// @fontsource/inter (SIL OFL 1.1) and @fontsource/metropolis (Unlicense) into
// assets/fonts/, where font.ts loads them from at runtime. Re-run after
// bumping either package to refresh.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fontsource = join(root, "node_modules", "@fontsource");
const dest = join(root, "assets", "fonts");

const files = [
  ["inter/files/inter-latin-400-normal.woff2", "Inter-Regular.woff2"],
  ["inter/files/inter-latin-700-normal.woff2", "Inter-Bold.woff2"],
  ["inter/LICENSE", "LICENSE-Inter.txt"],
  [
    "metropolis/files/metropolis-latin-400-normal.woff2",
    "Metropolis-Regular.woff2",
  ],
  [
    "metropolis/files/metropolis-latin-500-normal.woff2",
    "Metropolis-Medium.woff2",
  ],
  ["metropolis/LICENSE", "LICENSE-Metropolis.txt"],
];

async function main() {
  await mkdir(dest, { recursive: true });
  for (const [from, to] of files) {
    await copyFile(join(fontsource, from), join(dest, to));
  }
  process.stdout.write(`Vendored font files into ${dest}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
