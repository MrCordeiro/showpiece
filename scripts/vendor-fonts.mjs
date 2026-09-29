#!/usr/bin/env node
// One-off vendoring step: copies the two static weights vitrine needs out of
// @fontsource/inter (SIL OFL 1.1) into assets/fonts/, where font.ts loads
// them from at runtime. Re-run after bumping @fontsource/inter to refresh.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "node_modules", "@fontsource", "inter");
const dest = join(root, "assets", "fonts");

const files = [
  ["files/inter-latin-400-normal.woff2", "Inter-Regular.woff2"],
  ["files/inter-latin-700-normal.woff2", "Inter-Bold.woff2"],
  ["LICENSE", "LICENSE-Inter.txt"],
];

async function main() {
  await mkdir(dest, { recursive: true });
  for (const [from, to] of files) {
    await copyFile(join(src, from), join(dest, to));
  }
  process.stdout.write(`Vendored Inter font files into ${dest}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
