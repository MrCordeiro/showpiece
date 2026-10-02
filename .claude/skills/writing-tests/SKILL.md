---
name: writing-tests
description: >
  Gates whether a new Vitest test in vitrine should exist and forces it to be cheap, so the suite stays fast and trustworthy.
  Use before adding or substantially changing any test in this repo - a new feature, a bugfix, or a PR. Front-loads the value bar and the efficiency bar.
  Includes a "don't write it" list.
---

# Writing tests worth keeping

Run this before writing tests. It carries the decision procedure.

vitrine uses Vitest. Tests are in `test/`, one `<area>-<unit>.test.ts` file per unit (for example `test/frame-manifest.test.ts`, `test/publish-command.test.ts`). Fixtures are in `test/fixtures/`.

## The gate: two questions

Answer both in one sentence each before writing any test.

### 1. Does it earn its place?

> **What realistic regression does this test catch that no existing test already catches?**

If you cannot name the bug, the code path, and the input that would break, do not write the test. "Increases coverage", "good practice", and "the function exists" are not answers.

A good answer sounds like: _"if someone sends `publish` without `ERROR_IF_IN_REVIEW`, a pending release review is cancelled; this fails"_ or _"a caption change on another screen changes the shared text size; this locks in that the image reads as stale."_

### 2. Where does it go?

Passing the first question buys the coverage, not a new test function. Find the test that already covers the nearest behaviour and answer:

> **Why can't this be an `it.each` row in that test?**

Extend it when your case is a variation of the same behaviour. A new standalone test is what you write when the setup differs, the behaviour belongs to a different unit, or no relevant test exists. Name which of the three applies.

Search `test/` before you write. If you have not looked for the nearest existing test, you cannot answer this.

## Don't write it - the five no's

1. **Trivial or library behaviour.** Do not test that a zod `.optional()` field is optional, that sharp writes a PNG, that commander parses a flag, or that a wrapper passes its argument through to a library call.
2. **Change-detector tests.** A test that rebuilds the expected value with the same functions the code uses, or asserts which internal functions were called, fails on every refactor and catches no real bug. Test observable behaviour through the public interface: return value, exit code, files written, printed output, calls at an external boundary (the Play API, `adb`, `maestro`).
3. **Redundant coverage.** Several tests that exercise one path with different data are one `it.each`.
4. **Coverage-chasing.** Do not add a test to hit a number. An uncovered line is information, not a defect. If the only reason to test a branch is coverage, the branch may be dead code to delete instead.
5. **Source-scraping tests.** Never read or regex-parse one file's source from another test to check that they agree. Give the two sides one source of truth that both import, and assert against that.

When the answer is "don't write it", the right move is often to extend an existing test or delete code rather than test it.

## If you write it - pick the cheapest level

Each level is slower and more fragile than the one before it:

```text
pure function  →  function with temp files  →  command with mocks  →  sharp render / golden image
   cheapest                                                              most expensive
```

Aim for many tests at the left, few at the right.

- **Pure function.** Schema parsing (`configSchema`), hashes (`inputHash`), checks that take a `Buffer` (`playImageProblem`), error mapping (`toPublishError`), name matching (`suggestName`). Pass values in, assert the return value. Create image buffers in memory with `sharp({ create: … })`; do not write them to disk unless the code under test reads files.
- **Function with temp files.** For code whose job is file I/O (`readManifest`, `checkListing`, `loadConfig`). Use a temp directory, never the repo.
- **Command with mocks.** `runCapture`, `runFrame`, `runPublish`. Mock `../src/config/load.js` to supply the config, mock `../src/util/exec.js` (or the capture modules) for `adb` and `maestro`, and inject a fake `PlayClient` through `PublishDeps`. Use this level for orchestration: order of external calls, exit codes, cleanup after failure.
- **Sharp render.** `runFrame` and `composeFrame` load sharp and fonts and take hundreds of milliseconds. When many tests need framed images, frame once in `beforeAll` and copy the folder into each test. Golden-image comparisons belong only in `test/frame-golden.test.ts` (cases in `test/fixtures/frame/cases.ts`; regenerate with `npm run golden:update`).
- When something is hard to test cheaply, that is a design signal. Extract the logic into a pure function and test that.

## Boundaries and types

- Mock only at the boundary: the Google library (`@googleapis/androidpublisher`) in `test/publish-play.test.ts`, and a fake `PlayClient` everywhere else. No test calls the real Play API or a real device.
- Compile-time behaviour (for example, `defineConfig` rejecting a misspelled listing name) goes in a `test/*.typecheck.ts` file with `// @ts-expect-error`. Vitest does not run these files; `npm run typecheck` checks them.

## Running

- `npm test` runs the whole suite (`vitest run`). `npx vitest run test/<file>.test.ts` runs one file.
- Run `npm run typecheck` and `npm run lint` too. Biome checks formatting, and `npm run format` fixes it.
- `vitest.config.ts` sets a 20 s `testTimeout`, because tests that run sharp load it cold in parallel workers. A test that needs more time is a cost signal, not a reason to raise the limit.

## Determinism and isolation

- No `setTimeout`, `sleep`, or arbitrary waits. Use fake timers or wait on a real condition.
- No real network, device, emulator or external service. Mock the boundary.
- Tests pass in any order and in isolation. Do not rely on state that a previous test left behind.
- Delete what a test creates. Restore spies (`vi.restoreAllMocks()` or `mockRestore()`) that replace `process.stdout.write` or other globals.
- No `it.only` or `describe.only` in a commit. It skips every other test in the file.
- No `.skip` without a one-line reason and a linked issue. A permanently skipped test is dead weight; delete it or fix it.

## Before you open the PR

The PR description says how you tested the change. State the justification where a reviewer will see it. One line per group of tests:

> _"Added 3 `it.each` rows to `publish-listing.test.ts` covering alpha, too-small and too-narrow images - guards the Play limits; extended the existing `playImageProblem` test because it is the same check."_

If you cannot write that line, the test should not be in the PR.
