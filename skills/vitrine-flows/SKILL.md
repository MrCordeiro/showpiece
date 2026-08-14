---
name: vitrine-flows
description: Use when `vitrine capture` fails or a Maestro flow under .vitrine/flows/ needs fixing — reads vitrine's diagnostics output to find the failing step and repairs the flow or vitrine.config.ts.
---

# vitrine-flows

You're fixing a failed `vitrine capture` run in an app repo that consumes
`vitrine` as a dev dependency. **Edit this repo's `vitrine.config.ts` and
`.vitrine/flows/*.yaml` only — never vitrine's own source.** Treat vitrine
itself as fixed and work within it.

## Conventions

- A flow's only job: reach one screen in a known-good state, then
  `takeScreenshot` once. `assertVisible`/`extendedWaitUntil` are readiness
  gates, not the point of the flow — this isn't a test suite.
- **`takeScreenshot` name must equal the screen's `id`** in
  `vitrine.config.ts`. Mismatch → `E_FLOW_CONVENTION` before Maestro runs.
- Dark mode suffixes everything with `-dark`: `raw/<id>-dark.png`,
  `.vitrine/diagnostics/<id>-dark/`. Both appearances coexist.
- `vitrine.config.ts`, not the filesystem, decides which flows run. A flow
  file does nothing until it's referenced in `screens[]`.
- Re-runs must render identical pixels (fixed demo data, deliberate
  `clearState`, no live timestamps). Different content each run is a flow
  bug even when capture "succeeds."

## Start here: `.vitrine/diagnostics/`

Every attempted screen — success or failure — gets a directory. Read
`last-run.json` first, then drill into the failing screen:

```
.vitrine/diagnostics/
  last-run.json              start here: per-screen status + code + path
  <id>/
    context.json              vitrine's record: flow, serial, exitCode,
                               status, error, timestamp
    commands.json              Maestro's per-step log — sort by
                               metadata.sequenceNumber (array order ≠
                               execution order) and find the first
                               non-"COMPLETED" step
    failure-screenshot.png     pixels AT the failing step
    hierarchy.json             view hierarchy AFTER the flow ended — usually
                               but not always the failing screen (a crash or
                               teardown can leave the launcher on screen).
                               Good for authoring selectors; trust
                               failure-screenshot.png for what was actually
                               on screen when the step failed
    maestro.log                Maestro's own log
    maestro-stdout.log         combined stdout+stderr of the maestro process
    crash-signals.log          grepped logcat: native crashes, Java
                               exceptions, process death, "Running main" —
                               check first for E_APP_CRASHED or an
                               unexplained stall
    logcat.txt                 full logcat for the attempt, for anything
                               crash-signals.log missed
```

`last-run.json`:

```json
{
  "schemaVersion": 1,
  "screens": [
    { "id": "home", "status": "failed", "code": "E_FLOW_FAILED",
      "error": "Step failed: assertVisible: Home after 10.0s (FAILED). ...",
      "diagnosticsDir": ".vitrine/diagnostics/home" }
  ],
  "summary": { "total": 2, "captured": 1, "failed": 1 }
}
```

Read `error` first — it names the failing step. Check
`failure-screenshot.png` next. Fall back to `commands.json`/`hierarchy.json`
only for selector-level detail.

## Error code → fix

| Code | Meaning | Try |
| --- | --- | --- |
| `E_FLOW_CONVENTION` | `takeScreenshot` name ≠ screen `id`, or missing | Match the flow's `takeScreenshot` to `id` in config |
| `E_APP_CRASHED` | App process was gone when the flow failed — **not a selector bug** | Read `crash-signals.log`; see "App crashed, not the flow" below |
| `E_FLOW_FAILED` | A step failed with the app still alive (bad selector, screen never appeared, timeout) | Read `commands.json`'s failing step + `failure-screenshot.png` |
| `E_SCREENSHOT_MISSING` | Flow completed but never called `takeScreenshot` for this id | Add `- takeScreenshot: <id>` |
| `E_APP_NOT_INSTALLED` | Package isn't on the device, no `apkPath` set | Install the build, or set `app.apkPath` |
| `E_APK_NOT_FOUND` | `app.apkPath` points nowhere | Fix the path or rebuild |
| `E_METRO_UNREACHABLE` / `E_METRO_NOT_READY` | Metro isn't up | Start/wait for `npx expo start` — not a flow bug |
| `E_METRO_UNEXPECTED_RESPONSE` | Something else owns `device.metroPort` | Free the port or change it |
| `E_DEVICE_NOT_FOUND` / `E_DEVICE_UNAUTHORIZED` | `--serial` device not connected/authorized | Reconnect/authorize — not a flow bug |
| `E_EMULATOR_BOOT_TIMEOUT` / `E_DEVICE_BOOT_TIMEOUT` | AVD didn't finish booting | Re-run; check `device.avd` |
| `E_INVALID_PACKAGE_NAME` | `app.packageName` malformed | Fix the config value |
| `E_CONFIG_INVALID` / `E_CONFIG_NOT_FOUND` | `vitrine.config.ts` broken | Fix the config — not a flow bug |
| `E_UNKNOWN` | Not a vitrine error — read the message as-is | The message is the only evidence |

## App crashed, not the flow

A stalled bundle fetch and a crashed app look identical to Maestro: an
assertion that never comes true. `commands.json` can't tell them apart —
vitrine checks whether the app's process is still alive after a failure so
you're not editing a selector that was never the problem.
`code: "E_APP_CRASHED"` → the flow is probably fine; go to
`crash-signals.log`.

**Real incident:** a dev-client app looked hung on its "Loading from
`<host>`:8081…" banner. Metro checked out fine — reachable, `adb reverse`
mapped. Actual cause: the installed native build was compiled against
`react-native-worklets@0.10.0`; `node_modules` had moved to `0.10.1` after a
dependency bump with no matching native rebuild. Metro served the newer JS
to the older `.so`, the JSI contract broke, and the app **SIGABRT'd ~1s
after the JS bundle started** — invisibly, because the crashed process's
last-drawn frame just stays on screen. One `logcat` grep for
`Fatal signal`/`Abort message` named it in seconds; that's why
`crash-signals.log` exists.

If you hit `E_APP_CRASHED` (or an `E_FLOW_FAILED` that doesn't point at a
real selector bug) on an app using native packages
(`react-native`/`-reanimated`/`-worklets`/etc.), suspect a version mismatch:
`npx expo prebuild` prints `› Using X@installed instead of recommended
X@package.json` when there's drift, and an abort message often names the
built-against version directly. Fix: rebuild the native app
(`npx expo prebuild -p android && npx expo run:android`), not the flow —
vitrine never rebuilds the app itself.

## Reaching known-good state, regardless of device state

A flow should reach its target screen whether the device is warm and
already set up, or a fresh install starting from onboarding. Build this as
a shared, unconditional sub-flow every screen calls first — not per-flow
special-casing:

```yaml
# home.yaml
- launchApp
- runFlow: ./_ensure-ready.yaml   # idempotent — see below
- extendedWaitUntil:
    visible: "Net Worth"
    timeout: 90000
- takeScreenshot: home
```

Inside `_ensure-ready.yaml`, gate every action on `when: visible:` so it's
a no-op when the app's already past that state:

```yaml
appId: com.example.app     # sub-flows need their own header too, or
---                         # Maestro errors "Config Section Required"

- extendedWaitUntil:         # wait for *something* before deciding what to
    visible: "Banner|SetupScreen|Home"   # do — see pitfall #1 below
    timeout: 120000

- runFlow:
    when:
      visible: "Banner"
    commands:
      - tapOn: { point: "90%,72%" }   # dismiss, see pitfall #4

- runFlow:
    when:
      visible: "SetupScreen"
    commands:
      - tapOn: { point: "14%,81%" }   # see pitfall #4
      - tapOn: "Continue"
```

Five pitfalls this pattern runs into:

1. **`when: visible:` checks instantly — it doesn't wait.** Right after
   `launchApp`, nothing may be rendered yet, especially on a fresh install
   (first-launch-after-install is measurably slower than warm). Precede a
   `when:`-gated branch with an `extendedWaitUntil` on an alternation of
   every state you might land on (`"A|B|C"`), so the branch decision waits
   for *something* real to render first. Make it generous (60–120s); it
   only costs time when needed, since `extendedWaitUntil` returns as soon
   as its condition is true.
2. **Emoji-containing text doesn't reliably match in Maestro**, even as a
   plain ASCII substring search (confirmed: `"Nice to meet you"` failed to
   match `"Nice to meet you! 👋"` repeatedly; the same string without the
   emoji matched instantly). Pick an emoji-free anchor nearby instead.
3. **Sub-flows referenced via `runFlow: file:` still need their own
   `appId`/`---` header**, even though they aren't top-level flows.
4. **Elements with no text/testID need point taps, not text selectors.**
   Be suspicious of tapping a label next to one, too: if the label's text
   overlaps a nested link/button, tapping the label taps the link instead
   — the usual way "just tap the checkbox's label" breaks. Verify a point
   tap actually landed via `maestro hierarchy`'s `checked`/state attributes,
   not a screenshot (which can look right before the tap registers). Never
   debug tap coordinates with raw `adb shell input tap` — its mapping
   doesn't reliably match Maestro's own `tapOn`. Test taps by running an
   actual `maestro test`.
5. **First-connect dev-menu banners can persist indefinitely** — don't
   assume they auto-dismiss (one was confirmed still on screen after 8+
   minutes). Dismiss explicitly, gated on the banner's own title text so
   the tap never fires on an unrelated screen. If a flow force-loads a
   dev-client with `openLink: "<scheme>://expo-development-client/?url=..."`,
   note the dev-client silently drops a deep link that arrives while a
   previous load is still in flight — `stopApp` before `openLink` in
   back-to-back flows avoids the race.

## The fast loop

```bash
npx vitrine capture --only <id>
```

Safe to repeat — only touches that screen's `raw/` and diagnostics output.

## When Maestro's own tools are the better fit

vitrine's diagnostics are **post-mortem evidence of a run that already
ended**. For live device interaction while authoring a fix, use Maestro
directly:

- `maestro --device <serial> hierarchy` — live view hierarchy.
- `maestro check-syntax <flow>` — validate YAML before running it.
- `maestro mcp` — device/automation commands as MCP tools, if configured.

## After fixing a flow

1. `npx vitrine capture --only <id>` — confirm it captures cleanly.
2. Re-run the full `npx vitrine capture` once — a shared-setup fix can
   affect other screens.
3. Never hand-edit `.vitrine/diagnostics/` or `.vitrine/screenshots/` —
   both are generated output, overwritten every run.
