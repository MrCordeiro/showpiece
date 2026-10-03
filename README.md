<h1 align="center">showpiece</h1>

<p align="center">
  <strong>Your app changed. Your Play Store screenshots did not.</strong><br/>
  Capture, frame and publish them from the terminal, with one config file. 📸
</p>

<div align="center">

[![CI](https://github.com/MrCordeiro/showpiece/actions/workflows/ci.yml/badge.svg)](https://github.com/MrCordeiro/showpiece/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/showpiece)](https://www.npmjs.com/package/showpiece)
[![codecov](https://codecov.io/github/MrCordeiro/showpiece/graph/badge.svg?token=C7XCKA49FF)](https://codecov.io/github/MrCordeiro/showpiece)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

![A raw screenshot of an app next to the same screenshot after showpiece frame: a caption above a stylized phone on a dark background](docs/images/before-after.png)

<!-- TODO: demo GIF of capture → frame → publish --dry-run -->

| | showpiece |
| -- | --------- |
| 📱 | **Works with the build you already have.** Use a debug build, an Expo dev client, or last month's APK. |
| 🖼️ | **Frames screenshots automatically.** Add a caption, phone, and your colors without maintaining a Figma file. |
| 🚀 | **Publishes to Google Play.** Replace your listing screenshots directly from the terminal. Use `--dry-run` to validate everything without making changes. |
| 🎯 | **Produces identical output every time.** Your laptop and CI generate byte-identical images. |
| 🩺 | **Explains failed flows.** Get per-screen diagnostics, plus an agent skill that can read them and repair the flow. |
| 🛡️ | **Never cancels a review.** Your Play Store's pending release are never impacted. |

## Why showpiece?

Every release ended with the same tedious routine: open the emulator, navigate to each screen, take screenshots, drop them into a design tool, export them, and upload them to Play Console. Then the app changed again, and the screenshots were out of date again.

Most screenshot workflows require a production build, a design tool, or fastlane and Ruby. My production builds take 30 minutes, so I wanted something that could work with whatever build was already running on the emulator.

showpiece uses [Maestro](https://maestro.mobile.dev) to navigate to each screen, [sharp](https://sharp.pixelplumbing.com) to frame the screenshots, and the Play Developer API to publish them. A single config file defines the screens you want and the captions for each one.

## Quickstart

You need Node.js 22.12+, [Maestro](https://maestro.mobile.dev/getting-started/installing-maestro) and `adb` on your PATH, and an Android emulator.

```bash
npm install --save-dev showpiece
```

Create `showpiece.config.ts` at the root of your app repo:

```ts
import { defineConfig } from "showpiece";

export default defineConfig({
  app: { packageName: "com.example.myapp" },
  device: { avd: "Pixel_7_API_34" },
  frame: {
    template: "gradient",
    background: ["#1a1a2e", "#16213e"],
    textColor: "#ffffff",
  },
  publish: { serviceAccountKeyPath: "./.envs/play-service-account.json" },
  screens: [
    {
      id: "home",
      flow: ".showpiece/flows/home.yaml",
      caption: "Track everything in one place",
    },
  ],
});
```

Add one Maestro flow per screen. It ends with `takeScreenshot`, named after the screen `id`:

```yaml
# .showpiece/flows/home.yaml
appId: com.example.myapp
---
- launchApp
- extendedWaitUntil:
    visible: "Home"
    timeout: 60000
- takeScreenshot: home
```

Start Metro (`npx expo start`) if you use a debug build or a dev client, then:

```bash
npx showpiece capture            # screenshots → .showpiece/screenshots/raw/
npx showpiece frame              # framed images → .showpiece/screenshots/framed/
npx showpiece publish --dry-run  # validate on Google Play, change nothing
```

`publish` needs a service account first: see [Publish setup](#publish-setup). The [`example/`](example/) folder has a complete config and three flows.

## Help shape showpiece

showpiece is young, and what we build next depends on how you make store screenshots today. Maybe you use showpiece every week, maybe you tried it once, or maybe you are only curious. I would like to hear from you either way.

- **A 15-min call:** [book a time](https://cal.com/fernando-cordeiro/how-you-make-store-screenshots-showpiece). These calls decide the roadmap. As thanks, I email you a one-page summary of what I learn: how other teams make their store screenshots, and what I build next.
- **No time for a call?** Tell me in [Discussions](https://github.com/MrCordeiro/showpiece/discussions).

## Configuration

```ts
import { defineConfig } from "showpiece";

export default defineConfig({
  app: {
    packageName: "com.example.myapp",
    // apkPath: "./builds/app-release.apk", // optional; omit it if the app is already installed
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
    font: "Metropolis",          // or "Inter"
  },
  publish: {
    serviceAccountKeyPath: "./.envs/play-service-account.json",
    track: "listing",
    listing: ["profile.png", "home.png"], // optional; see Publish
  },
  appearance: "light",
  screenshotsDir: ".showpiece/screenshots", // optional; this is the default
  screens: [
    {
      id: "home",
      flow: ".showpiece/flows/home.yaml",
      caption: "Track everything in one place",
      subtitle: "Every account, one screen", // optional
      background: "#3ccf91",                 // optional; overrides frame.background
      textColor: "#1a1a1a",                  // optional; overrides frame.textColor
    },
    { id: "profile", flow: ".showpiece/flows/profile.yaml", caption: "Your data, your way" },
  ],
});
```

Config files can be `.ts`, `.js`, `.mjs` or `.json`. Paths are relative to the config file.

Commit `.showpiece/flows/`, and ignore the generated output:

```gitignore
.showpiece/screenshots/
.showpiece/diagnostics/
```

## Writing flows

Each screenshot gets its own flow. The one required rule is that the `takeScreenshot` name must match the screen `id`.

>[!note]
> We recommend using fixed demo data for consistent screenshots.

`frame` shows only the top ~70% of each screenshot, so keep the important content in the top two-thirds.

**Debug builds and dev clients:**

- Use a plain `- launchApp`, not `clearState: true`. `clearState` deletes the saved Metro URL and your login state.
- Wait for an element of your app, with a long timeout (`60000`). The first bundle load can take a minute.
- If a dev client opens its launcher, use `- openLink: "myapp://expo-development-client/?url=http://localhost:8081"` instead of `launchApp`.

**Standalone APKs:** set `device.devServer: false`. Then `clearState: true` is safe to use.

### Expo Router: deep-link to screens

With [Expo Router](https://docs.expo.dev/router/introduction/), every route is a URL, and a deep link is more reliable than taps through the UI. Set a scheme in `app.json` (`{ "expo": { "scheme": "myapp" } }`), and Expo Router makes the links from your file routes:

| Route file | Deep link |
| --- | --- |
| `app/index.tsx` | `myapp://` |
| `app/(tabs)/home.tsx` | `myapp://home`  *(the `(tabs)` group is omitted)* |
| `app/settings/account.tsx` | `myapp://settings/account` |
| `app/user/[id].tsx` | `myapp://user/42` |
| `app/search.tsx` | `myapp://search?q=trees` |

```yaml
# .showpiece/flows/profile.yaml
appId: com.example.myapp
---
- launchApp
- openLink: myapp://profile
- extendedWaitUntil:
    visible: "Your data, your way"
    timeout: 10000
- takeScreenshot: profile
```

- Test a link once with `adb shell am start -a android.intent.action.VIEW -d "myapp://profile" com.example.myapp`. Expo Go (`exp://`) is not supported; use a dev client.
- Put ids in the URL (`myapp://user/42`) to show the same demo data on every run.
- For modals and bottom sheets, use `tapOn: { id: "your-testID" }`.
- If a screen animates in, add `waitForAnimationToEnd` before `takeScreenshot`.

`example/.showpiece/flows/` has a deep link (`profile.yaml`), a nested route (`settings.yaml`) and a flow that starts from `launchApp` (`home.yaml`).

## Capture

```bash
npx showpiece capture                         # every configured screen
npx showpiece capture --only home,profile     # a subset
npx showpiece capture --serial emulator-5554  # a specific device
npx showpiece capture --appearance dark       # dark mode
npx showpiece capture --clean                 # empty raw/ first
npx showpiece capture --config ./path/to/showpiece.config.ts
```

`capture` boots the AVD if no emulator runs, installs `apkPath` if you set one, and connects the app to Metro. It sets a clean status bar (9:30, full battery), runs each flow in config order, and prints a summary. It exits with a non-zero code if a screen failed.

For a debug build or a dev client, start Metro first:

```bash
# terminal 1, in your app repo
npx expo start

# terminal 2
npx showpiece capture
```

## Frame

```bash
npx showpiece frame                       # every configured screen
npx showpiece frame --only home,profile   # a subset
```

`frame` makes a 1080×1920 PNG for each raw screenshot: your caption and optional `subtitle` at the top, and a large phone below them. Three templates (`frame.template`):

| Template | Look |
| --- | --- |
| `gradient` | A flat phone outline on a two-stop gradient. |
| `solid` | The same, on a flat colour. |
| `minimal` | No phone outline: the screenshot with rounded corners and a soft shadow. |

`screens[].background` and `screens[].textColor` override the colours for one screen. The fonts are Metropolis (default) and Inter, bundled with showpiece.

## Dark mode

```bash
npx showpiece capture --appearance dark   # or set appearance: "dark" in the config
```

Dark screenshots get a `-dark` suffix (`home-dark.png`), so a light run and a dark run can share one folder. `frame` and `publish` use the same names.

>[!warning]
> **Your app must follow the system appearance.** In Expo, set `"userInterfaceStyle": "automatic"` in `app.json`. Otherwise you get light screenshots with `-dark` names.

## Publish

### Publish setup

`publish` uses a Google Cloud service account with a JSON key. Do this once per app:

1. In a Google Cloud project, enable the **Google Play Android Developer API**.
2. Create a service account with no IAM roles, and create a JSON key for it.
3. Save the key at `publish.serviceAccountKeyPath`, and add its folder to `.gitignore`.
4. In Play Console → **Users and permissions**, invite the service account's email and give it **Manage store presence** for the app.
5. Wait a few minutes, then run `npx showpiece publish --dry-run`.

<details>
<summary>Steps 1–3 with OpenTofu or Terraform</summary>

The state file of this configuration contains the private key. Do not commit or share the state file.

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

resource "google_project_service" "androidpublisher" {
  service            = "androidpublisher.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "showpiece" {
  account_id   = "showpiece-publisher"
  display_name = "showpiece Play listing publisher"
}

resource "google_service_account_key" "showpiece" {
  service_account_id = google_service_account.showpiece.name
}

resource "local_sensitive_file" "key" {
  content_base64  = google_service_account_key.showpiece.private_key
  filename        = "${path.root}/../.envs/play-service-account.json"
  file_permission = "0600"
}

output "service_account_email" {
  value = google_service_account.showpiece.email
}
```

</details>

### Commands

```bash
npx showpiece publish --dry-run  # upload and validate, then delete the change
npx showpiece publish            # show the listing, ask, then commit
npx showpiece publish --yes      # commit without asking (for scripts)
```

`publish.listing` sets which images go to the store, in order:

```ts
publish: {
  serviceAccountKeyPath: "./.envs/play-service-account.json",
  listing: [
    "home.png",                           // a framed screen
    "budget-dark.png",                    // light or dark, per entry
    "./marketing/budget-highlighted.png", // any image of your own, uploaded as it is
  ],
},
```

Without `listing`, `publish` uses every screen in config order. If your dev build has its own package name (for example `com.example.myapp.dev`), set `publish.packageName` to the app on Google Play.

Before it uploads, `publish` prints the listing with a status for each image:

| Status | Meaning | Stops the run |
| ----------- | ------- | ------------- |
| `ok` | Ready to upload. | No |
| `stale` | The raw screenshot or the config changed after `frame`, or someone edited the framed file. Run `showpiece frame` to update it. | No |
| `missing` | The file does not exist, or the name does not match a screen. The table suggests a similar name. | Yes |
| `too large` | The file is larger than 8 MB. | Yes |
| `invalid` | The file is not PNG or JPEG, has an alpha channel, or has incorrect dimensions. | Yes |

If your release or an earlier listing change is still in review, `publish` stops with `E_PUBLISH_IN_REVIEW` and changes nothing. Run it again after Google approves the change.

## Troubleshooting

Every capture writes evidence for each screen to `.showpiece/diagnostics/`:

```txt
.showpiece/diagnostics/
  last-run.json              status and error code of each screen in the last run
  home/
    context.json             flow, device, exit code, status
    commands.json            Maestro's log of each step
    failure-screenshot.png   the screen at the failed step
    hierarchy.json           the view hierarchy at the end
    maestro.log              Maestro's own log
    maestro-stdout.log       Maestro's output
    crash-signals.log        crashes and process deaths from logcat
    logcat.txt               the full device log
```

Each failure has an error code (`E_FLOW_FAILED`, `E_APP_CRASHED`, `E_METRO_UNREACHABLE`, …) in the summary and in `last-run.json`.

### Let an agent fix failed flows

The `showpiece-flows` skill teaches a coding agent the flow rules, the diagnostics layout and the fix for each error code.

```bash
npx showpiece skill install          # writes .claude/skills/showpiece-flows/SKILL.md
npx showpiece skill install --force  # replaces an installed copy
```

Claude Code finds the skill automatically, but I haven't tested this extensively. Run the command again after you upgrade showpiece, to get the new version of the skill.

**Other agents (Codex, Cursor, Copilot and others).** The skill is at `node_modules/showpiece/skills/showpiece-flows/SKILL.md`. You may need to add a line to the agent's instruction file (for example `AGENTS.md`, or a rule in `.cursor/rules/`):

```md
When `showpiece capture` fails, read node_modules/showpiece/skills/showpiece-flows/SKILL.md before you change a flow.
```

This path always refers to the installed version, so the agent gets the new skill when you upgrade showpiece.

## Contributing

Bug reports, feature requests and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
