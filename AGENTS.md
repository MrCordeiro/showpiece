# AGENTS.md

This file is for coding agents and for contributors who want the details. User documentation is in [README.md](README.md). Setup, issues and pull requests are in [CONTRIBUTING.md](CONTRIBUTING.md).

## What showpiece is

showpiece is a TypeScript CLI that makes Google Play screenshots. It has three commands that use one config file:

```text
showpiece.config.ts ──► capture ──► .showpiece/screenshots/raw/*.png
                        frame   ──► .showpiece/screenshots/framed/*.png
                        publish ──► Google Play listing
```

Each command runs on its own. A fourth command, `skill install`, copies the bundled `showpiece-flows` skill into the user's repo.

## Commands

```bash
npm install
npm run lint           # biome: lint and format check
npm run format         # biome: apply fixes
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build          # tsdown → dist/ (ESM, .d.ts, bin)
npm run golden:update  # regenerate the frame golden images (see Testing)
```

CI runs lint, typecheck, test and build on Node 22.12 and 24 for every push to `main` and every pull request. Run the same four commands before you say a change is done.

## Architecture

| Folder | Contents |
| --- | --- |
| `src/cli.ts` | The `commander` program. It parses flags and calls the commands. |
| `src/config/` | The `zod` schema (`schema.ts`) and the loader (`load.ts`). The loader uses `jiti` for `.ts`, `.js` and `.mjs` files, and `JSON.parse` for `.json`. |
| `src/capture/` | Device control with `adb` (`device.ts`), the Maestro runner (`maestro.ts`) and the per-screen diagnostics (`diagnostics.ts`). |
| `src/frame/` | The compositor. `sharp` composites the layers. `fontkit` converts text to SVG glyph paths. The bezel is SVG that the code generates. |
| `src/publish/` | Listing resolution and statuses (`listing.ts`), the story table (`story.ts`) and the Play Developer API client (`play.ts`). |
| `src/skill/` | `skill install`. |
| `src/util/` | `ShowpieceError` and error codes (`errors.ts`), process execution (`exec.ts`), the run report (`report.ts`). |
| `src/index.ts` | The public exports: `defineConfig`, the schemas, `loadConfig` and the config types. |
| `skills/showpiece-flows/` | The skill that users install. It is part of the npm package. |
| `.agents/skills/` | Skills for contributors and coding agents (tests, comments, PR descriptions). `.claude/skills` is a symlink to this folder, so Claude Code finds them too. |
| `assets/fonts/` | The bundled fonts (Metropolis and Inter). |
| `example/` | A sample config and three sample flows. |

External tools: `capture` runs `maestro` and `adb`. The user needs to install both. When a tool is missing, the command fails with a message that tells the user what to install.

## How showpiece uses Maestro

Maestro is usually an E2E test tool: `maestro test .maestro/`, pass or fail, artifacts in `~/.maestro/`. showpiece uses Maestro only to navigate to a screen. These are the differences:

- **A flow is not a test.** A flow goes to one screen in a known state and calls `takeScreenshot` once. An `assertVisible` is a readiness gate before the screenshot. A flow passes when its screenshot exists.
- **The CLI runs the flows, not Maestro.** showpiece never runs `maestro test` on a folder. It runs each flow alone, in config order. This lets it map each output to a screen id, support `--only`, and print a summary per screen.
- **showpiece decides where the output goes.** A screenshot goes to `<screenshotsDir>/raw/<id>.png`, never to Maestro's default folder.
- **The `takeScreenshot` name must equal the screen `id`.** `capture` checks this before Maestro runs and fails with `E_FLOW_CONVENTION`.
- **Determinism over coverage.** A second run must give the same image. There are no retries.
- **The CLI controls the device.** It finds a running emulator with `adb devices`, boots the configured AVD when there is none, and installs `apkPath` when it is set. There is no Maestro Cloud.
- **App state, not app build.** Flows run against the installed build (a debug build, a dev client or an old APK). No code may require a new production build.

## Design rules

These rules are true for all code. A change that breaks one needs a discussion in an issue first.

1. **The config is the single source of truth.** The config decides which screens and flows run. Future tools (for example the AI diff-discovery agent, issue #12) should change the config and the flows only.
2. **`raw/` is a store, not a run folder.** A run writes `raw/<id>[-dark].png` only for a screen that it captured. It deletes that same file only when that screen's flow failed. It never changes another screen's file, or the same screen's other appearance. Only `capture --clean` empties the folder.
3. **Diagnostics exist for every attempted screen.** `capture` creates `<diagnosticsDir>/<id>[-dark]/` and writes `context.json` before flow validation. A screen in `last-run.json` always has a folder with at least `context.json`.
4. **`frame` is deterministic.** The same inputs give byte-identical PNGs on every machine. Do not use system fonts, a headless browser or any input that changes between runs.
5. **`frame` writes `framed/manifest.json`.** Each entry has an input hash (raw bytes, caption, subtitle, colours, template, font, text sizes and the showpiece version) and an output hash. `publish` uses it to mark an image `stale`. A run changes only the entries of the images that it framed.
6. **`publish` never cancels a review.** `edits.commit` always uses `changesInReviewBehavior: ERROR_IF_IN_REVIEW`. The default value can cancel a pending app release. This is fixed behaviour, not an option.
7. **`publish` uploads what exists.** It never captures or frames again. It stops before any API call when an entry is `missing`, `too large` or `invalid`, or when the count is not 2 to 8.
8. **showpiece never builds or uploads an app binary.** It changes listing images only.
9. **Every expected failure is a `ShowpieceError` with an `E_*` code.** The codes are part of the public API (see [Versioning and releases](#versioning-and-releases)). When you add or change a code, update the code table in `skills/showpiece-flows/SKILL.md`.
10. **Every path in the config is relative to the config file**, not to `process.cwd()`.

The config fields, the diagnostics layout and the publish statuses are documented in the README. Do not copy them here.

## Testing

- **Unit tests** cover config validation, listing resolution and statuses, the story table and the Play API calls (with a mocked `googleapis`).
- **Golden images for `frame`.** `test/fixtures/frame/` has raw inputs and expected outputs. `test/frame-golden.test.ts` compares them with `pixelmatch` at threshold 0. The cases are in `test/fixtures/frame/cases.ts`. After an intended change to a template, run `npm run golden:update`, then look at every changed image before you commit it. That review is what makes the images golden.
- **Temp folders.** Create them only with `makeTempDir(prefix)` from `test/temp-dir.ts`. `test/global-setup.ts` deletes the root folder after the run, also when tests fail.
- **Manual integration.** Run `capture` against a local emulator, and `publish --dry-run` against a real listing. A Play edit changes nothing until `edits.commit`.
- **Package test.** Run `npm pack`, then install the tarball in an app repo.

Before you add a test, read [`writing-tests`](.agents/skills/writing-tests/SKILL.md).

## Commits and pull requests

- Commit messages use Conventional Commits: `feat(frame): ...`, `fix(capture): ...`, `docs: ...`, `test: ...`, `chore: ...`. The scope is the command or area.
- The subject says what the change does, in the imperative mood.
- Before you write a PR description, read [`writing-pr-descriptions`](.agents/skills/writing-pr-descriptions/SKILL.md).
- Before you add or change a code comment, read [`writing-code-comments`](.agents/skills/writing-code-comments/SKILL.md).

## Versioning and releases

showpiece uses [semantic versioning](https://semver.org). The public API is:

- the CLI commands and flags
- the config schema: `defineConfig` and the other exports in `src/index.ts`
- the output folder layout under `.showpiece/`
- the error codes (`E_*`)

A breaking change to any of these needs a major version. A new feature needs a minor version. A fix needs a patch version. Before 1.0.0, a breaking change needs a minor version (for example 0.1.x → 0.2.0), and every other change needs a patch version. Version 1.0.0 comes when the config schema is stable.

When a change breaks the public API, say so in the commit message and in the PR description.

Only maintainers can make releases:

1. In a PR, run `npm version <major|minor|patch> --no-git-tag-version`. This changes the version in `package.json` and `package-lock.json` only. Merge the PR.
2. On GitHub, create a release from `main` with a new tag `v<version>`, for example `v0.2.0`. The tag must equal the version in `package.json`. "Generate release notes" drafts the notes from the merged PRs. The release notes are the changelog.
3. Publish the release. The release workflow (`.github/workflows/release.yml`) runs the checks, compares the tag with `package.json`, and stages the package on npm with provenance.
4. Approve the staged version with 2FA on npmjs.com, or with `npm stage approve <stage-id>`. The version is public only after this step.

## Writing style

Docs, comments, issues and PR descriptions use Simplified Technical English: active voice, one idea per sentence, the same word for the same thing, no idioms and no metaphors.
