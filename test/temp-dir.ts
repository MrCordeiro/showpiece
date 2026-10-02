import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { inject } from "vitest";

/** Creates a folder that test/global-setup.ts deletes after the run. */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(inject("tempRoot"), prefix));
}
