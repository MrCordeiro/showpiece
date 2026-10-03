import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    tempRoot: string;
  }
}

/**
 * Every temp folder a test makes is inside one root per run, so the teardown
 * removes them all, also after failed tests. Use `makeTempDir` from
 * test/temp-dir.ts, never `mkdtemp` in the OS temp directory.
 */
export default function setup(project: TestProject): () => void {
  const tempRoot = mkdtempSync(join(tmpdir(), "showpiece-test-run-"));
  project.provide("tempRoot", tempRoot);
  return () => rmSync(tempRoot, { recursive: true, force: true });
}
