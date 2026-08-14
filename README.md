# vitrine

Play Store screenshot pipeline CLI. Capture Android app screenshots with
[Maestro](https://maestro.mobile.dev), frame them into store-ready images, and
publish them to a Google Play listing via the Play Developer API — one command,
no design tool, no fastlane.

> **Status:** milestone 1 (`capture`), including per-screen diagnostics and a
> bundled troubleshooting skill, is implemented. `frame` and `publish` land in
> subsequent milestones.

## How it works

```txt
vitrine.config.ts ──► vitrine capture ──► .vitrine/screenshots/raw/*.png
                          vitrine frame   ──► .vitrine/screenshots/framed/*.png   (soon)
                          vitrine publish ──► Google Play listing               (soon)
```

Each command is independently runnable and shares one config file.

## Requirements

- Node.js 20+
- [`maestro`](https://maestro.mobile.dev/getting-started/installing-maestro) on your
  PATH — installed separately and requires a Java runtime
- Android platform-tools (`adb`) on your PATH
- `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) set if you want vitrine to boot an AVD for you

## Install

Until this is published to npm, install the packed tarball as a dev dependency
in your app repo:

```bash
# in the vitrine repo
npm pack                       # builds dist/ (prepack) and produces vitrine-0.1.0.tgz

# in your app repo
npm install --save-dev ../vitrine/vitrine-0.1.0.tgz
```

## Configure

Create `vitrine.config.ts` at your app repo root (see `example/` here for a
complete sample):

```ts
import { defineConfig } from "vitrine";

export default defineConfig({
  app: {
    packageName: "com.example.myapp",
    // apkPath: "./builds/app-release.apk", // optional; omit if already installed
  },
  device: {
    avd: "Pixel_7_API_34",
    locale: "en-US",
    devServer: true, // Metro-backed dev build; false for a standalone APK
    metroPort: 8081,
  },
  frame: {
    template: "gradient",
    background: ["#1a1a2e", "#16213e"],
    textColor: "#ffffff",
    font: "Inter",
  },
  publish: {
    serviceAccountKeyPath: "./secrets/play-service-account.json",
    track: "listing",
  },
  appearance: "light",
  screenshotsDir: ".vitrine/screenshots", // optional; this is the default
  screens: [
    { id: "home", flow: ".vitrine/flows/home.yaml", caption: "Track everything in one place" },
    { id: "profile", flow: ".vitrine/flows/profile.yaml", caption: "Your data, your way" },
  ],
});
```

`.ts`, `.js`, `.mjs`, and `.json` config files are all supported.

Flows and generated screenshots both live under `.vitrine/` at your repo
root — a dedicated namespace so vitrine never collides with folders your app
already owns. `.vitrine/flows/` is authored and should be committed;
`.vitrine/screenshots/` and `.vitrine/diagnostics/` are generated output and
should be gitignored:

```gitignore
.vitrine/screenshots/
.vitrine/diagnostics/
```

## Writing flows

vitrine is **not** a Maestro test runner. Each flow's only job is to reach one
screen in a known-good state and call `takeScreenshot` once. Two rules:

1. **The `takeScreenshot` name must equal the screen `id`.** vitrine validates
   this before running and errors clearly on a mismatch.
2. **Seed deterministic state** (`clearState: true`, fixed demo data) so re-runs
   produce visually identical screens — this feeds the golden-image pipeline in
   `frame`.

```yaml
# .vitrine/flows/home.yaml
appId: com.example.myapp
---
- launchApp:
    clearState: true
- assertVisible: "Home"   # readiness gate, not the flow's purpose
- takeScreenshot: home    # name === screen id
```

### Expo Router: deep-link to screens

If your app uses [Expo Router](https://docs.expo.dev/router/introduction/),
every route is a URL. Deep-linking straight to a screen is more deterministic
than tapping through the UI and survives navigation refactors — prefer it.

Set a scheme in `app.json` (`{ "expo": { "scheme": "myapp" } }`); Expo Router
derives link paths from your file routes:

| Route file | Deep link |
| --- | --- |
| `app/index.tsx` | `myapp://` |
| `app/(tabs)/home.tsx` | `myapp://home`  *(the `(tabs)` group is omitted)* |
| `app/settings/account.tsx` | `myapp://settings/account` |
| `app/user/[id].tsx` | `myapp://user/42` |
| `app/search.tsx` | `myapp://search?q=trees` |

```yaml
# .vitrine/flows/profile.yaml — reach the route directly, then capture
appId: com.example.myapp
---
- launchApp:
    clearState: true
- openLink: myapp://profile
- extendedWaitUntil:        # waits for async screens (vs. failing instantly)
    visible: "Your data, your way"
    timeout: 10000
- takeScreenshot: profile
```

Notes:

- A **dev-client** build registers the custom scheme, so `myapp://…` works
  against the installed build (Expo Go uses `exp://` and is not the target here).
  Sanity-check once with:
  `adb shell am start -a android.intent.action.VIEW -d "myapp://profile" com.example.myapp`
- Pass ids/params through the URL (`myapp://user/42`) to seed stable demo data,
  so re-runs are visually identical — this feeds the golden-image pipeline.
- For screens that aren't directly routable (modals, bottom sheets), fall back to
  `tapOn: { id: "your-testID" }`. Prefer `testID` selectors over visible text.
- Add `waitForAnimationToEnd` before `takeScreenshot` if a screen animates in, so
  captures are pixel-stable.

See `example/.vitrine/flows/` for deep-link (`profile.yaml`), nested-route (`settings.yaml`),
and launch-based (`home.yaml`) variants.

## Capture

```bash
npx vitrine capture                       # capture every configured screen
npx vitrine capture --only home,profile   # capture a subset
npx vitrine capture --serial emulator-5554  # target a specific device
npx vitrine capture --appearance dark      # capture in dark mode
npx vitrine capture --clean               # empty raw/ first (e.g. to drop orphans)
npx vitrine capture --config ./path/to/vitrine.config.ts
```

What it does:

1. Loads and validates the config.
2. Detects a running emulator via `adb devices`; if none, boots the configured
   AVD and waits for boot to complete.
3. Installs `apkPath` (`adb install -r`) if set, otherwise verifies the package
   is already installed.
4. For a dev build (`device.devServer: true`), forwards the Metro port with
   `adb reverse` and verifies Metro is running (see below).
5. Runs each screen's flow in config order, writing `.vitrine/screenshots/raw/<id>.png`
   and per-screen troubleshooting evidence to `.vitrine/diagnostics/<id>/` (see
   [Troubleshooting](#troubleshooting)).
6. Prints a summary table plus a run report path, and exits non-zero if any screen failed.

Capture works against **any installed build** — never a production build.

`raw/` accumulates across runs. A run only writes the PNGs for the screens it
captured, and only removes a PNG when that screen's own flow failed (so `frame`
and `publish` never pick up an image no successful capture produced).

## Capturing a Metro-backed debug build

This is the primary target: any build that loads its JS bundle from the **Metro** bundler at runtime rather than embedding it — a plain `npx expo run:android` debug build, or an Expo **dev client**. Neither is self-contained: if Metro isn't reachable, the app hangs on the splash screen and every capture is just the splash.

vitrine handles the wiring when `device.devServer` is `true` (the default):
before capturing it runs `adb reverse tcp:<metroPort> tcp:<metroPort>` so the
emulator can reach Metro on your host, then forces the app to actually resolve Metro via `localhost` instead of the emulator's default `10.0.2.2` NAT alias — large chunked bundle-download responses can get silently corrupted in transit over that NAT path, hanging the app on the splash screen with no error surfaced. It does this by writing `debug_http_host` directly into the app's own SharedPreferences via `adb shell run-as` (no `adb root` required, so it works against any debuggable build). Finally it probes `http://127.0.0.1:<metroPort>/status` — failing fast with an actionable message if Metro isn't up. You still start Metro yourself:

```bash
# terminal 1 — in your app repo, leave running
npx expo start            # or: npx expo run:android (builds + starts Metro)

# terminal 2
npx vitrine capture
```

Flow gotchas for Metro-backed debug builds:

- **Don't use `launchApp: { clearState: true }`** — on a dev-client build it
  wipes the saved Metro URL and drops you on the dev launcher/splash; on a   plain debug build it wipes any onboarding/auth state and drops you on your   app's first-run flow instead of the target screen. Use a bare `- launchApp` and, if your app has onboarding, complete it once manually on   the installed build so state persists across capture runs. (Enable `clearState` only for standalone builds, below.)
- **Gate on a real post-load element with a long timeout** — the first Metro
  bundle load can take 10–60s, so wait on a `testID` that only mounts with your app, not splash text:

  ```yaml
  - launchApp
  - extendedWaitUntil:
      visible: { id: "home-screen" }
      timeout: 60000
  - takeScreenshot: home
  ```

- If a dev-client build opens the launcher, force-load the bundle instead of
  `launchApp`: `- openLink: "myapp://expo-development-client/?url=http://localhost:8081"`.

**Standalone builds:** for a release/preview APK that embeds the bundle (e.g.
`expo run:android --variant release`, or an EAS `preview` build), set
`device.devServer: false` — vitrine then skips the Metro wiring entirely.

## Dark mode

Set the UI mode the device captures in — in the config, or per run:

```ts
// vitrine.config.ts
appearance: "dark",   // "light" (default) | "dark"
```

```bash
npx vitrine capture                       # uses the configured appearance
npx vitrine capture --appearance dark     # overrides it for one run
```

Dark-mode screenshots are saved with a `-dark` suffix, so both sets coexist:

```txt
.vitrine/screenshots/raw/home.png        # light
.vitrine/screenshots/raw/home-dark.png   # dark
```

Capturing both is two runs against the same config, in either order — the second run adds its own files without disturbing the first run's:

```bash
npx vitrine capture --appearance light
npx vitrine capture --appearance dark
```

Under the hood vitrine runs `adb shell cmd uimode night <yes|no>` before the
flows and restores the device's previous mode afterwards. Reading back and
restoring the device's mode needs Android 10 / API 29 or newer; on older
system images vitrine leaves the mode as-is and warns instead of forcing a
change.

> **Your app has to follow the system appearance for this to do anything.** In
> Expo that means `"userInterfaceStyle": "automatic"` (or `"dark"`) in
> `app.json` — the default is `"light"`, which ignores the system setting
> entirely and will hand you light screenshots named `-dark`.

## Troubleshooting

Every attempted screen — success or failure — leaves per-screen evidence
under `.vitrine/diagnostics/<id>[-dark]/`, and every run writes a
machine-readable summary to `.vitrine/diagnostics/last-run.json`:

```txt
.vitrine/diagnostics/
  last-run.json              per-screen status + error code + path, for the most recent run
  home/
    context.json               vitrine's own record: flow, serial, exitCode, status, timestamp
    commands.json               Maestro's per-step log
    failure-screenshot.png      pixel state at the failing step (failures only)
    hierarchy.json              view hierarchy after the flow ended
    maestro.log                 Maestro's own log
    maestro-stdout.log          combined stdout+stderr of the maestro process
    crash-signals.log           grepped logcat: native crashes, Java exceptions, process death
    logcat.txt                  full device logcat captured during the attempt
```

Vitrine also checks whether the app's process is still alive after a
failure — a stalled bundle fetch and a crashed app look identical to
Maestro (an assertion that never becomes true), so this is the only
reliable way to tell them apart. A dead process reports `E_APP_CRASHED`
with `crash-signals.log` as the pointer, instead of a generic assertion
failure that sends you hunting for a selector bug that was never there.

The summary table also prints the diagnostics path for any failed screen:

```txt
Capture summary
---------------
✗ home  Step failed: assertVisible: Home after 10.0s (FAILED). See ...
        → diagnostics: .vitrine/diagnostics/home

1 screen(s) · 0 captured · 1 failed
```

Failures carry a machine-readable `code` (`E_FLOW_CONVENTION`,
`E_FLOW_FAILED`, `E_METRO_UNREACHABLE`, `E_APP_NOT_INSTALLED`, …) in both the
summary and `last-run.json`.

### Let an agent fix it

```bash
npx vitrine skill install          # writes .claude/skills/vitrine-flows/SKILL.md
npx vitrine skill install --force  # overwrite an already-installed copy
```

This installs a Claude Code skill (commit it — it's small and repo-specific)
that documents vitrine's conventions, the diagnostics layout above, and an
error-code → fix-recipe table, so an agent working in your repo can read a
failed run's evidence and repair the flow or `vitrine.config.ts` itself. It
never touches vitrine's own source. Re-run after upgrading vitrine to pick up
skill updates.

## Development

```bash
npm install
npm run lint        # biome (lint + format check)
npm run format      # biome --write (apply fixes)
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsdown → dist/ (ESM + .d.ts + bin)
```

CI (GitHub Actions) runs lint, typecheck, tests, and build on Node 20 and 22
for every push to `main` and every pull request.

## License

MIT
