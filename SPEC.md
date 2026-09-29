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

TypeScript CLI package, Node 20+, developed in its **own standalone repo** (not inside the app repo — Metro's upward `node_modules` resolution and file watching conflict with nested packages, and a separate repo matches the goal of publishing to npm). The app repo is the first consumer: it holds only `vitrine.config.ts`, `.vitrine/` (flows and generated screenshots), the gitignored `secrets/`, and its instantiation of the infra module, and installs the tool as a dev dependency (via `npm pack` tarball until published). `.vitrine/` namespaces everything vitrine owns under one dedicated root so it can't collide with folder names a client app already uses.

Three independent commands sharing one config file:

```
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
    font: "Inter",               // bundled font(s); no system font dependence
  },
  publish: {
    serviceAccountKeyPath: "./secrets/play-service-account.json",
    track: "listing",            // images only; field reserved for clarity
  },
  appearance: "light",         // "light" | "dark"; dark output is suffixed `-dark`
  screenshotsDir: ".vitrine/screenshots", // optional; this is the default
  diagnosticsDir: ".vitrine/diagnostics", // optional; this is the default
  screens: [
    {
      id: "home",
      flow: ".vitrine/flows/home.yaml",   // Maestro flow that ends on the target screen
      caption: "Track everything in one place",
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

### P0 — `frame`

- [x] Composites each `.vitrine/screenshots/raw/<id>.png` into a store-ready image: device bezel overlay, background (solid or 2-stop linear gradient), caption text above the device.
- [x] Output: `.vitrine/screenshots/framed/<id>.png` at **1080×1920 (9:16)**, PNG, under Play's 8 MB limit.
- [x] Three templates: `gradient` (caption top, device centered-bottom, gradient bg), `solid` (same layout, flat bg), `minimal` (no bezel, subtle shadow, caption top).
- [x] Bundle one open-license font (Inter) in the package and render text and device bezel with sharp's SVG compositing for deterministic output. The device bezel is generated programmatically, not from a bundled image.
- [x] Idempotent: re-running produces byte-identical output for identical inputs (required for golden tests).

### P0 — `polished frame`

- [ ] Replace the existing simple device frame with a detailed, premium, matte black aluminum phone frame (e.g., modern premium hardware).
- [ ] Significantly enlarge the entire device within the viewport, reducing the left and right padding to be minimal (e.g., approx 5% of the total width) so the device nearly fills the canvas horizontally.
- [ ] Position the device lower so that the bottom part of the physical frame is clipped off the edge of the viewport, giving the sense of the device extending continuously downward.
- [ ] All the exterior background color to be selected by a hex code or predefined theme.
- [ ] Allow for an optiona subtitle
- [ ] Use a strong, simple headline/subheadline treatment, generous whitespace, tighter composition, and more intentional spacing so the screenshot feels like an App Store marketing asset rather than a raw app capture.

### P0 — `publish`

- [ ] Auths with a service account key; clear error if key invalid or lacks permissions.
- [ ] Uses the androidpublisher v3 **edits** flow: `edits.insert` → `edits.images.deleteall` (phoneScreenshots, configured locale) → upload framed images in config order → `edits.validate` → `edits.commit`.
- [ ] `--dry-run`: performs everything through `edits.validate`, then **deletes the edit instead of committing**. Prints what would change.
- [ ] Uploads in the order screens appear in config (order = listing order).
- [ ] Prints a link to the Play Console listing page on success.

### P1

- [ ] `vitrine init` — scaffolds config, `.vitrine/flows/` with one example, `.gitignore` entries for `secrets/` and `.vitrine/screenshots/` (generated output).
- [ ] `capture --serial <device>` to target a specific device/emulator.
- [ ] Feature graphic (1024×500) generation from the same frame templates.
- [ ] Progress/spinner output (`ora` or similar).

### P2 (design for, don't build)

- iOS capture + App Store Connect publishing.
- Multi-locale: config `screens[].caption` becomes `Record<locale, string>`; capture loops locales.
- AI diff-discovery agent that edits config + flows on PRs.
- CI workflow templates.

## Testing Strategy

- **Unit**: config validation (zod cases), publish payload construction (mock `googleapis`).
- **Golden-image tests for `frame`**: commit fixture raw PNGs + expected framed outputs; compare with `pixelmatch`, threshold 0 (framing must be deterministic). This is the core regression suite.
- **Integration (manual, documented in README)**: `capture` against a local emulator; `publish --dry-run` against the real API — the edits API is transactional, so nothing touches the live listing until commit.
- **Package-level**: test via `npm pack` + install the tarball into the app repo (closer to real consumption than `npm link`).

## Infrastructure (IaC)

The only cloud infrastructure this project needs is Google Cloud plumbing for the Play Developer API. The tool repo ships this as a reusable **OpenTofu** module in `infra/` (the HCL below is also plain-Terraform-compatible); the app repo instantiates it with its own `project_id`:

```hcl
# infra/main.tf
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
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

# Service account the CLI authenticates as
resource "google_service_account" "vitrine" {
  account_id   = "vitrine-publisher"
  display_name = "vitrine Play listing publisher"
}

# Key used by `vitrine publish` (JSON)
resource "google_service_account_key" "vitrine" {
  service_account_id = google_service_account.vitrine.name
}

resource "local_sensitive_file" "key" {
  content_base64 = google_service_account_key.vitrine.private_key
  filename       = "${path.module}/../secrets/play-service-account.json"
}

output "service_account_email" {
  value = google_service_account.vitrine.email
}
```

Requirements:

- [ ] `infra/` ships with the module above, a `terraform.tfvars.example`, and a README section: `tofu init && tofu apply -var project_id=...`.
- [ ] `secrets/` is gitignored; state file handling documented (local state is fine for a single dev; note the SA key lives in state).
- [ ] No GCP IAM role bindings — this is intentional. Play listing permissions are **not** GCP IAM; they are granted inside Play Console.

**Manual steps that cannot be automated** (no Terraform/API surface exists for Play Console account linking — document these in the README as a checklist):

1. Play Console → **Users and permissions** → invite the `service_account_email` output.
2. Grant the account **"Manage store presence"** (edit store listing) for the app.
3. Wait up to a few minutes for propagation, then run `vitrine publish --dry-run` to verify.

## Milestones

1. **capture** (days 1–3): CLI scaffold, config loader/validation, emulator + adb orchestration, Maestro runner. Exit criteria: raw PNGs for all configured screens from one command.
2. **frame** (days 4–6): compositor + 3 templates + golden tests. Exit criteria: deterministic framed set at 1080×1920.
3. **publish** (days 7–8): `infra/` OpenTofu module + README checklist first, then API client, dry-run, commit path. Exit criteria: `tofu apply` produces a working key, dry-run passes validation against the real listing, one successful real commit.

Ship each milestone as a working increment — do not start `frame` until `capture` works end-to-end on the real app.

## Open Questions

- ~~**Bezel asset**~~ — resolved in milestone 2: generated programmatically in `sharp`/SVG (`src/frame/bezel.ts`), no bundled image asset.
- **Config format** (non-blocking): `.ts` config is the default; decide during implementation whether to also accept `.json` for zero-tooling consumers.
- **Play Console linking** (owner: repo owner, blocking for milestone 3 only): the OpenTofu module provisions the API + service account + key, but the Play Console invite/permission grant (see Infrastructure section) is manual and must happen before `publish --dry-run` can be tested.
