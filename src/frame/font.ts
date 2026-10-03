// src/frame/font.ts
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// fontkit is CJS-only (`main: "dist/main.cjs"`, no ESM export), so it's
// loaded via createRequire rather than a static `import` — a plain
// `import fontkit from "fontkit"` fails with "does not provide an export
// named 'default'" under this project's ESM/NodeNext setup.
const require = createRequire(import.meta.url);
const fontkit = require("fontkit") as { create: (buffer: Buffer) => unknown };

/**
 * Walk up from `startDir` looking for `assets/<relativePath>`. Bundled
 * assets live at the package root, but this module can be imported either
 * unbundled from `src/frame/` (tests, dev) or bundled flat into `dist/`
 * (the published package) — searching upward avoids hardcoding a specific
 * `../` depth that only one of those two layouts would satisfy.
 */
export function findAssetPath(
  relativePath: string,
  startDir: string,
  maxLevels = 5,
): string {
  let dir = startDir;
  for (let i = 0; i <= maxLevels; i++) {
    const candidate = join(dir, "assets", relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  throw new Error(
    `Could not locate bundled asset "assets/${relativePath}" starting from ${startDir}.`,
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The narrow slice of fontkit's real runtime API this codebase depends on.
 * fontkit ships no `@types/fontkit` package and no bundled type
 * declarations, so this local shape is hand-written and verified against
 * fontkit 2.0.4's actual runtime behavior (see caption.ts for how it's used).
 */
export interface FontkitPath {
  scale(sx: number, sy: number): FontkitPath;
  translate(x: number, y: number): FontkitPath;
  toSVG(): string;
}
export interface FontkitGlyph {
  path: FontkitPath;
}
export interface FontkitGlyphPosition {
  xAdvance: number;
}
export interface FontkitGlyphRun {
  glyphs: FontkitGlyph[];
  positions: FontkitGlyphPosition[];
  advanceWidth: number;
}
export interface FontkitFont {
  familyName: string;
  unitsPerEm: number;
  capHeight: number;
  layout(text: string): FontkitGlyphRun;
  hasGlyphForCodePoint(codePoint: number): boolean;
}

export interface FontAsset {
  family: string;
  headline: FontkitFont;
  body: FontkitFont;
  /** Extra space after each headline glyph, in em. */
  headlineTracking: number;
}

interface FontFiles {
  headline: string;
  body: string;
  headlineTracking: number;
}

/** configSchema's `frame.font` enum must list exactly these keys. */
const FONTS: Record<string, FontFiles> = {
  // Metropolis Medium at -0.05em matches the approved headline design.
  Metropolis: {
    headline: "Metropolis-Medium.woff2",
    body: "Metropolis-Regular.woff2",
    headlineTracking: -0.05,
  },
  Inter: {
    headline: "Inter-Bold.woff2",
    body: "Inter-Regular.woff2",
    headlineTracking: -0.02,
  },
};

function parseFont(path: string): FontkitFont {
  const buffer = readFileSync(path);
  return fontkit.create(buffer) as unknown as FontkitFont;
}

const loaded = new Map<string, FontAsset>();

/** Load a bundled font by name for glyph-outline extraction (see caption.ts). */
export function loadFont(name: string): FontAsset {
  const cached = loaded.get(name);
  if (cached) return cached;
  const files = FONTS[name];
  if (!files) {
    throw new Error(
      `Unknown font "${name}". Bundled fonts: ${Object.keys(FONTS).join(", ")}.`,
    );
  }
  const font: FontAsset = {
    family: name,
    headline: parseFont(findAssetPath(`fonts/${files.headline}`, HERE)),
    body: parseFont(findAssetPath(`fonts/${files.body}`, HERE)),
    headlineTracking: files.headlineTracking,
  };
  loaded.set(name, font);
  return font;
}
