# vitrine — Play Store screenshot pipeline CLI

## Problem Statement

Updating the Google Play listing for our React Native (Expo) Android app is manual and painful: capturing screenshots by hand, styling them in a design tool, and uploading them through the Play Console UI. Production builds take ~30 minutes and run locally, so any pipeline that depends on a fresh production build is a non-starter. We want screenshots to become a one-command artifact.

## Goals

1. Refresh the entire Play Store screenshot set with a single command run locally.
2. Capture works against **any installed build** (a plain Metro-backed debug build, an Expo dev client, or the last local APK) — never requires the 30-minute production build.
3. Framing produces store-compliant, professional images from templates with zero design-tool work.
4. Publishing updates the live listing via the Play Developer API with a safe dry-run mode.
5. The package is structured so it can later be published to npm (`npx vitrine ...`) and extended with an AI diff-discovery layer.

## Non-Goals (v0)

- **iOS / App Store Connect** — Android only; the app is Android-only today.
- **Localization** — single locale (`en-US`) hardcoded as a config default; the config schema should carry a `locale` field so multi-locale is additive later.
- **CI integration** — local-first. No GitHub Actions work in v0.
- **AI diff-discovery** (reading git diffs to find new screens) — this is the eventual differentiator but layers on top of the deterministic core. Do not build it; do not block it architecturally. The AI layer will work by editing `vitrine.config.ts` and Maestro flows, so keeping config as the single source of truth is the only architectural requirement.
- **Full design editor** — 2–3 fixed layout templates only. No per-pixel positioning.
- **APK building/uploading** — the tool never builds or uploads app binaries, only listing images.

## Architecture Overview

TypeScript CLI package, Node 22.12+, developed in its **own standalone repo** (not inside the app repo — Metro's upward `node_modules` resolution and file watching conflict with nested packages, and a separate repo matches the goal of publishing to npm). The app repo is the first consumer: it holds only `vitrine.config.ts`, `.vitrine/` (flows and generated screenshots), the gitignored service account key, and installs the tool as a dev dependency (via `npm pack` tarball until published). `.vitrine/` namespaces everything vitrine owns under one dedicated root so it can't collide with folder names a client app already uses.

Three independent commands sharing one config file:

```text
vitrine.config.ts ──► capture ──► .vitrine/screenshots/raw/*.png
                          frame   ──► .vitrine/screenshots/framed/*.png
                          publish ──► Google Play listing
```

- **CLI framework**: `commander`
- **Config validation**: `zod` (config is a `.ts` file loaded via `jiti` or `tsx`, exporting a typed object)
- **Capture**: shells out to `maestro` and `adb` (both assumed installed; fail with actionable error messages if missing)
- **Framing**: `sharp` for compositing, `fontkit` for glyph-outline caption text (added during implementation); no headless browser
- **Publish**: direct Google Play Developer API (`adroidpublisher v3`) via `googleapis`, service-account JSON auth.

Each command must be independently runnable and independently useful.

## How this differs from a standard Maestro setup

Maestro is normally used as an E2E **testing** tool (`maestro test .maestro/`, pass/fail semantics, artifacts in `~/.maestro/`). Here it is repurposed as a deterministic **navigation engine for screenshots**, which changes several conventions — implement accordingly:

- **Flows are not tests.** Each flow's job is to reach one screen in a known-good state and call `takeScreenshot` once. Assertions (`assertVisible`) are used as *readiness gates* before capturing (wait until UI settled), not as the flow's purpose. A flow "passes" when its screenshot exists.
- **The CLI orchestrates, not Maestro.** We do not run `maestro test` on a directory. The CLI invokes flows individually, in config order, so it can map outputs to screen ids, support `--only`, and produce a per-screen summary. Config (`vitrine.config.ts`) is the source of truth for *which* flows run — not the filesystem.
- **Output location is ours.** Screenshots must land in `.vitrine/screenshots/raw/<id>.png` (use `maestro test --output` / `working-dir` control or move artifacts post-run), never left in Maestro's default artifact directory. The `takeScreenshot` name ↔ screen `id` convention is validated by the CLI.
- **Determinism over coverage.** Standard Maestro suites tolerate flakiness with retries and test many paths. Re-runs produce visually identical screens — this feeds the golden-image pipeline.
- **Device lifecycle is managed by the CLI**, not by the developer or Maestro Cloud: detect running emulator via `adb devices`, boot the configured AVD when absent, install the APK if `apkPath` is set. No Maestro Cloud / hosted execution in v0.
- **App state, not app build.** Flows run against whatever build is installed (dev client or old APK). Nothing in the Maestro layer may assume a fresh production build.

## Config Schema (source of truth)

Example `vitrine.config.ts` the tool must support:

```ts
import { defineConfig } from "vitrine";

export default defineConfig({
  app: {
    packageName: "com.example.myapp",
    apkPath: "./builds/app-release.apk", // optional; if omitted, assume app already installed
  },
  device: {
    avd: "Pixel_7_API_34",      // emulator to boot if none running
    locale: "en-US",
  },
  frame: {
    template: "gradient",        // "gradient" | "solid" | "minimal"
    background: ["#1a1a2e", "#16213e"], // solid color or gradient stops
    textColor: "#ffffff",
    font: "Metropolis",          // "Metropolis" (default) | "Inter"; bundled, no system font dependence
  },
  publish: {
    serviceAccountKeyPath: "./.envs/play-service-account.json",
    track: "listing",            // images only; field reserved for clarity
    packageName: "com.example.myapp", // optional; the Play app to edit when it differs from app.packageName
    listing: [                   // optional; the ordered phone screenshots that publish uploads (2–8)
      "home.png",                // a file in <screenshotsDir>/framed/
      "profile-dark.png",
      "./marketing/budget-highlighted.png", // an image vitrine did not make; sent to Play as it is
    ],
  },
  appearance: "light",         // "light" | "dark"; dark output is suffixed `-dark`
  screenshotsDir: ".vitrine/screenshots", // optional; this is the default
  diagnosticsDir: ".vitrine/diagnostics", // optional; this is the default
  screens: [
    {
      id: "home",
      flow: ".vitrine/flows/home.yaml",   // Maestro flow that ends on the target screen
      caption: "Track everything in one place",
      subtitle: "Every account, one screen", // optional
      background: "#3ccf91",                // optional; overrides frame.background
      textColor: "#1a1a1a",                 // optional; overrides frame.textColor
    },
    {
      id: "profile",
      flow: ".vitrine/flows/profile.yaml",
      caption: "Your data, your way",
    },
  ],
});
```

`screenshotsDir` (optional, defaults to `.vitrine/screenshots`) is where `capture`/`frame`/`publish` read and write generated output (`<screenshotsDir>/raw/<id>.png`, `<screenshotsDir>/framed/<id>.png`); it's resolved relative to the config file, same as `flow` and `apkPath`. Override it only if `.vitrine/` itself collides with something in the client repo.

`appearance` (optional, defaults to `"light"`) is the system UI mode the device is put into before capturing, via `adb shell cmd uimode night`. A dark run writes `<screenshotsDir>/raw/<id>-dark.png` instead of `<id>.png`, so both appearances coexist in one directory; `frame` and `publish` follow the same convention. `--appearance <light|dark>` overrides the config for a single run, and the device's previous night mode is restored afterwards. This only affects the captured pixels if the app under test follows the system appearance (Expo: `userInterfaceStyle: "automatic"`).

`<screenshotsDir>/raw/` is a persistent store keyed by screen id + appearance, not a per-run output directory. A run may only write `raw/<id>[-dark].png` for a screen it captured, and remove that same path when that screen's flow failed (so `frame`/`publish` can never read an image no successful capture produced). It never touches another screen's file or the same screen's other appearance — so `--only` and single-appearance runs are additive. `capture --clean` is the only way to empty the directory, for cases like orphaned PNGs left behind by a renamed screen id.

`diagnosticsDir` (optional, defaults to `.vitrine/diagnostics`) mirrors that same contract for per-screen troubleshooting evidence, keyed at `<diagnosticsDir>/<id>[-dark]/`. Unlike `raw/`, a directory is written for **every attempted screen, success or failure**: this also catches "it captured, but it's the wrong screen." A run wipes and recreates only the directories of the screens it attempted; `--clean` empties it alongside `raw/`. The directory is created and a baseline `context.json` written *before* flow validation runs, so even a screen that fails a convention check (never reaches Maestro) still leaves evidence behind. If a screen is named in `<diagnosticsDir>/last-run.json`, its directory exists and contains at least `context.json`. Full layout, error-code table, and how to read it: `skills/vitrine-flows/SKILL.md` (installed into a client repo via `vitrine skill install`).

`publish.listing` (optional) is the ordered list of phone screenshots that `publish` uploads. The order is the listing order. `screens` is the catalog of images that `capture` and `frame` produce. `listing` is the story that the store shows, and the user curates it: they change the order, select light or dark per entry, and add images from other sources. Each entry is one of:

- A bare file name, such as `"home.png"` or `"home-dark.png"`. It is a file in `<screenshotsDir>/framed/`. Its name must be `<id>.png` or `<id>-dark.png` for a screen in `screens`. `defineConfig` types these names from the declared `screens`, so the editor shows a typo before a run.
- A path that starts with `./` or `../`, such as `"./marketing/budget-highlighted.png"`. It is an image that vitrine did not make, for example a framed image that the user edited in Photoshop to add a highlight. vitrine finds the file relative to `vitrine.config.ts`. vitrine does not add a frame, a caption or a background to it: `publish` sends the file to Play exactly as it is on disk. Before the upload, `publish` checks only that the file is a valid Play screenshot (format, dimensions, 8 MB limit).

When `listing` is absent, `publish` uses every screen in config order, in the config `appearance`. A listing has 2 to 8 entries, which is the Play limit for phone screenshots in one language. Play has no dark-mode screenshot slot: every visitor sees the same set, so light or dark is a choice per entry, not a global rule.

Example Maestro flow (`.vitrine/flows/home.yaml`):

```yaml
appId: com.example.myapp
---
- launchApp:
    clearState: true
- assertVisible: "Home"
- takeScreenshot: home
```

Convention: each flow's `takeScreenshot` name must match the screen `id`. `capture` validates this and errors clearly on mismatch.

## Requirements

### P0 — `capture`

- [x] Reads and zod-validates config; fails with human-readable errors on invalid config.
- [x] Detects a running emulator via `adb devices`; if none, boots the configured AVD and waits for boot completion.
- [x] If `apkPath` is set, installs it (`adb install -r`); otherwise verifies the package is installed and errors helpfully if not.
- [x] Runs each screen's Maestro flow sequentially; collects PNGs into `.vitrine/screenshots/raw/<id>.png`.
- [x] `appearance: "light" | "dark"` (plus `--appearance`) sets the device UI mode for the run, suffixes dark output with `-dark`, and restores the device's prior mode.
- [x] `--only <id,id>` flag to capture a subset.
- [x] `raw/` accumulates across runs: a run only writes/removes the paths of the screens it attempted; `--clean` is the only bulk delete.
- [x] Non-zero exit code and a summary table (captured / failed) at the end.
- [x] Agents can easily troubleshoot and update failing flows.
- [x] Puts the device in Android demo mode before capturing (`settings put global sysui_demo_allowed 1`, then `am broadcast -a com.android.systemui.demo`): fixed clock (09:30), full mobile signal and battery, Wi-Fi and notification icons hidden. Exits demo mode afterwards and restores `sysui_demo_allowed`, as `appearance` restores the night mode. A failure to enter demo mode is a warning, not a failed run. Some system images never show a battery icon (for example the `Pixel_6_API_33` emulator), and demo mode cannot add one.

### P0 — `frame`

- [x] Composites each `.vitrine/screenshots/raw/<id>.png` into a store-ready image: device bezel overlay, background (solid or 2-stop linear gradient), caption text above the device.
- [x] Output: `.vitrine/screenshots/framed/<id>.png` at **1080×1920 (9:16)**, PNG, under Play's 8 MB limit.
- [x] Three templates: `gradient` (caption top, device centered-bottom, gradient bg), `solid` (same layout, flat bg), `minimal` (no bezel, subtle shadow, caption top).
- [x] Bundle one open-license font (Inter) in the package and render text and device bezel with sharp's SVG compositing for deterministic output. The device bezel is generated programmatically, not from a bundled image.
- [x] Idempotent: re-running produces byte-identical output for identical inputs (required for golden tests).

### P0 — `polished frame`

Target: a set of design mockups that the repo owner approved. The pixel values below are measured from those mockups at 1080×1920. The golden images in `test/fixtures/frame/expected/` now show the target.

- [x] **Stylized phone.** Replace the current bezel with a flat, stylized phone: one solid outline (20 px) with large outer corner radii (110 px). No buttons, camera cutout or hardware detail. The bezel is still generated in SVG (`src/frame/bezel.ts`).
- [x] **Large device.** The device outer edge is at x=140–940 (800 px wide, ~13% side padding). The screenshot is scaled to the screen opening (760 px wide, ~0.7×).
- [x] **Cropped device.** The device top is fixed at y=560 on every screen. The canvas cuts the device at the bottom edge. The bottom of the bezel and the bottom ~30% of the screenshot are not visible.
- [x] **Bezel colour follows the background.** On a light or saturated background the bezel is near-black. On a dark background (relative luminance below 0.05) the bezel is dark grey with a lighter stroke, so the outline stays visible.
- [x] **Background and text colour per screen.** `screens[].background` and `screens[].textColor` override `frame.background` and `frame.textColor` for that screen. With template `solid`, a per-screen background must also be a single colour.
- [x] **New font.** Metropolis (Unlicense), bundled in `assets/fonts/`: Medium (500) at −0.05 em letter spacing for the headline, Regular (400) for the subtitle. It is the default `frame.font`. `"Inter"` is still available.
- [x] **Headline.** Left-aligned at x=96, cap top at y=130, line height 1.0. With a subtitle: at most 2 lines, up to 106 px. Without a subtitle, the headline uses the subtitle's space: at most 3 lines, up to 118 px (the largest size whose third baseline is no lower than the lowest subtitle baseline). A multi-line headline is balanced: the breaks are at the word boundaries that make the longest line shortest, and among those, the shortest line longest. `frame` calculates the sizes over every screen in the config (also with `--only`): one headline size for screens with a subtitle, one for screens without, and one subtitle size. Each group uses the same size on every screen.
- [x] **Optional subtitle.** `screens[].subtitle`: at most 2 lines, regular weight, up to 40 px, left-aligned at x=96, 88 px below the last headline baseline. The device top does not move, with or without a subtitle.
- [x] **`minimal` template.** Uses the same text, screen position and bottom crop, without a bezel and with a soft shadow.
- [x] Update the golden-image fixtures. Cases: light background, dark background (stroked bezel), gradient background, and `minimal` without a subtitle. The case list is in `test/fixtures/frame/cases.ts`.
- [x] Document in `skills/vitrine-flows/SKILL.md` that the crop hides the bottom ~30% of the screen, so a flow must show the important content in the top two-thirds.

### P0 — `publish`

Usage context: a user runs `publish` after Google approves the app release, not at release time. The user captures, frames and edits the images during the review wait. So `publish` uploads the files that exist now. It never captures or frames again.

- [x] Auths with a service account key; clear error if key invalid or lacks permissions.
- [x] `frame` writes `<screenshotsDir>/framed/manifest.json`. For each framed image, the manifest records an input hash and an output hash. The input hash covers the raw file bytes, caption, subtitle, background, text colour, template, font, the shared text sizes, and the vitrine version. The output hash is the hash of the framed PNG. A run updates only the entries of the images it framed, the same as the `raw/` contract, so `--only` runs keep the other entries.
- [x] A framed entry is `stale` when it has no manifest entry, when its input hash differs from the hash of the current raw file and config, or when the framed file differs from the output hash (it was edited by hand). `stale` is a warning, not an error: the story table shows it, and the user decides. External `./` entries are never `stale`.
- [x] Resolves `publish.listing` (or the default when it is absent, see "Config Schema") to an ordered list of files before it calls the API.
- [x] Edits the listing of `publish.packageName` when it is set, else of `app.packageName`. `capture` often opens a dev build with its own package name, and the Play listing belongs to the production package name.
- [x] Prints a numbered story table before any API call: position, file, caption (framed entries only), and status: `ok`, `missing`, `stale`, `too large`, or `invalid` (not PNG or JPEG, has an alpha channel, or wrong dimensions). An unknown framed name gets a "did you mean `<name>`?" hint. Any `missing`, `too large` or `invalid` entry, or a count outside 2–8, stops the run before the API is called.
- [ ] Uses the androidpublisher v3 **edits** flow: `edits.insert` → `edits.images.deleteall` (phoneScreenshots, configured locale) → upload the listing files in listing order → `edits.validate` → `edits.commit`.
- [ ] `edits.commit` always uses `changesInReviewBehavior: ERROR_IF_IN_REVIEW`. The default (`CANCEL_IN_REVIEW_AND_SUBMIT`) can cancel changes that are in review, such as a pending app release. When Play returns the in-review error, `publish` explains that changes are in review and that the user must run `publish` again after Google approves them. This is fixed behaviour, not an option.
- [x] `--dry-run`: performs everything through `edits.validate`, then **deletes the edit instead of committing**. It prints the same story table.
- [ ] A real run asks `Commit <n> screenshots to <packageName>? [y/N]` after the story table. `--yes` skips the question. A run without a terminal (no TTY) and without `--yes` fails with a message that names `--yes`.
- [ ] Prints a link to the Play Console listing page on success.

### P1

- [ ] `vitrine init` — scaffolds config, `.vitrine/flows/` with one example, `.gitignore` entries for `.envs/` and `.vitrine/screenshots/` (generated output).
- [ ] `capture --serial <device>` to target a specific device/emulator.
- [ ] Feature graphic (1024×500) generation from the same frame templates.
- [ ] Progress/spinner output (`ora` or similar).
- [x] Tests delete their temp folders. A vitest `globalSetup` (`test/global-setup.ts`) creates one `vitrine-test-run-*` root folder per run and deletes it after the run, also when tests fail. It passes the path to the tests with `provide`/`inject`. Tests create temp folders only with `makeTempDir(prefix)` from `test/temp-dir.ts`, which creates them in that root. After a full run, the number of `vitrine-*` folders in the OS temp directory does not grow.

### P2 (design for, don't build)

- iOS capture + App Store Connect publishing.
- Multi-locale: config `screens[].caption` becomes `Record<locale, string>`; capture loops locales.
- AI diff-discovery agent that edits config + flows on PRs.
- CI workflow templates.

## Testing Strategy

- **Unit**: config validation (zod cases), listing resolution and story-table statuses, publish payload construction (mock `googleapis`).
- **Golden-image tests for `frame`**: commit fixture raw PNGs + expected framed outputs; compare with `pixelmatch`, threshold 0 (framing must be deterministic). This is the core regression suite.
- **Integration (manual, documented in README)**: `capture` against a local emulator; `publish --dry-run` against the real API — the edits API is transactional, so nothing touches the live listing until commit.
- **Package-level**: test via `npm pack` + install the tarball into the app repo (closer to real consumption than `npm link`).

## Infrastructure (IaC)

vitrine creates no cloud resources and ships no infrastructure code. `publish` needs only a Google service account JSON key at `publish.serviceAccountKeyPath`. The Play Developer API does not accept an API key for listing changes, so the credential must be a service account.

The app project owns the setup. It is done once per app, in the app's own Google Cloud project, with the app project's own IaC, state and naming rules. vitrine documents the setup in its README as a copy-paste example. The example below is OpenTofu and also plain-Terraform-compatible:

```hcl
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    local  = { source = "hashicorp/local", version = "~> 2.5" }
  }
}

variable "project_id" { type = string }

provider "google" {
  project = var.project_id
}

# Enable the Play Developer API on the project
resource "google_project_service" "androidpublisher" {
  service            = "androidpublisher.googleapis.com"
  disable_on_destroy = false
}

# Service account that `vitrine publish` authenticates as
resource "google_service_account" "vitrine" {
  account_id   = "vitrine-publisher"
  display_name = "vitrine Play listing publisher"
}

# JSON key that publish.serviceAccountKeyPath refers to
resource "google_service_account_key" "vitrine" {
  service_account_id = google_service_account.vitrine.name
}

resource "local_sensitive_file" "key" {
  content_base64  = google_service_account_key.vitrine.private_key
  filename        = "${path.root}/../.envs/play-service-account.json"
  file_permission = "0600"
}

output "service_account_email" {
  value = google_service_account.vitrine.email
}
```

Requirements:

- [ ] The README has a "Publish setup" section with the example above, a note that the app project must gitignore the key file and must not commit or share the state file (the state contains the private key), and the manual checklist below.
- [x] No GCP IAM role bindings. This is intentional. Play listing permissions are **not** GCP IAM; they are granted inside Play Console.

**Manual steps that cannot be automated** (no Terraform/API surface exists for Play Console account linking — document these in the README as a checklist):

1. Play Console → **Users and permissions** → invite the `service_account_email` output.
2. Grant the account **"Manage store presence"** (edit store listing) for the app.
3. Wait up to a few minutes for propagation, then run `vitrine publish --dry-run` to verify.

## Milestones

1. **capture** (days 1–3): CLI scaffold, config loader/validation, emulator + adb orchestration, Maestro runner. Exit criteria: raw PNGs for all configured screens from one command.
2. **frame** (days 4–6): compositor + 3 templates + golden tests. Exit criteria: deterministic framed set at 1080×1920.
2b. **polished frame**: stylized cropped device, Metropolis text, per-screen colours, status bar demo mode in `capture`. Exit criteria: the repo owner approves a framed set from the real app. Done.
3. **publish** (days 7–8): API client, dry-run, commit path, and the README setup section. The app project creates the service account key with the README example. Exit criteria: dry-run passes validation against the real listing, one successful real commit, and one real commit attempt while changes are in review returns the in-review error (it does not cancel the review). Status (2026-10-02): `tofu apply` created the key in the app project, and `publish --dry-run` passed validation against the real cashzilla listing (`com.pluckd.cashzilla`). The real commit and the commit attempt while changes are in review are still open.

Ship each milestone as a working increment — do not start `frame` until `capture` works end-to-end on the real app.

## Open Questions

- ~~**Bezel asset**~~ — resolved in milestone 2: generated programmatically in `sharp`/SVG (`src/frame/bezel.ts`), no bundled image asset.
- ~~**Headline font**~~: resolved in `polished frame`. Metropolis (Unlicense) matches the headline and subtitle in the design mockups.
- ~~**Templates after `polished frame`**~~: resolved. `minimal` uses the new text and bottom crop, without a bezel.
- **Config format** (non-blocking): `.ts` config is the default; decide during implementation whether to also accept `.json` for zero-tooling consumers.
- ~~**Stale framed images**~~: resolved. `frame` writes `framed/manifest.json` with input and output hashes, and `publish` compares it to the current raw files and config. Modification times were rejected because they miss a caption change in the config.
- **In-review behaviour** (verify during milestone 3): the API reference does not say exactly which changes `CANCEL_IN_REVIEW_AND_SUBMIT` cancels, or the error text that `ERROR_IF_IN_REVIEW` returns. Verify both against the real app before the error message is final.
- ~~**Play Console linking**~~: resolved. The service account `vitrine-publisher@cashzilla-app.iam.gserviceaccount.com` has "Manage store presence" for the cashzilla app, and `publish --dry-run` passes.
