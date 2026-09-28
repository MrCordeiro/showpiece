import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import type { Config } from "../config/schema.js";
import { VitrineError } from "../util/errors.js";
import { assertToolInstalled, delay, run, waitFor } from "../util/exec.js";

const BOOT_TIMEOUT_MS = 180_000;
const BOOT_POLL_MS = 2_000;

export interface AdbDevice {
  serial: string;
  /** e.g. "device", "offline", "unauthorized", "booting". */
  state: string;
}

/** Parse the output of `adb devices`. Pure — unit tested directly. */
export function parseAdbDevices(stdout: string): AdbDevice[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("*") && // adb daemon notices
        !line.startsWith("adb ") &&
        !/^List of devices attached/i.test(line),
    )
    .map((line) => {
      const [serial, state = "unknown"] = line.split(/\s+/);
      return { serial: serial ?? "", state };
    })
    .filter((device) => device.serial.length > 0);
}

function isEmulator(device: AdbDevice): boolean {
  return device.serial.startsWith("emulator-");
}

async function listDevices(): Promise<AdbDevice[]> {
  const { stdout } = await run("adb", ["devices"]);
  return parseAdbDevices(stdout);
}

/**
 * Resolve which device the capture run targets, booting the configured AVD if
 * no emulator is running. Returns the device serial.
 */
export async function resolveDevice(options: {
  serial?: string;
  avd: string;
}): Promise<string> {
  await assertToolInstalled(
    "adb",
    "Install Android platform-tools and ensure `adb` is on your PATH.",
    ["version"],
  );

  const devices = await listDevices();

  if (options.serial) {
    const match = devices.find((d) => d.serial === options.serial);
    if (!match) {
      const available = devices.map((d) => d.serial).join(", ") || "(none)";
      throw new VitrineError(
        "E_DEVICE_NOT_FOUND",
        `Device "${options.serial}" not found. Connected devices: ${available}.`,
      );
    }
    if (match.state === "unauthorized") {
      throw new VitrineError(
        "E_DEVICE_UNAUTHORIZED",
        `Device "${options.serial}" is unauthorized. Accept the "Allow USB debugging" prompt on the device (or revoke USB debugging authorizations and reconnect), then retry.`,
      );
    }
    if (match.state !== "device") {
      // e.g. "offline"/"booting" — wait for it to come up.
      await waitForBoot(options.serial);
    }
    return options.serial;
  }

  const ready = devices.find((d) => isEmulator(d) && d.state === "device");
  if (ready) return ready.serial;

  const booting = devices.find((d) => isEmulator(d));
  if (booting) {
    await waitForBoot(booting.serial);
    return booting.serial;
  }

  return bootAvd(options.avd);
}

/** Boot the given AVD and wait for it to finish booting. Returns its serial. */
async function bootAvd(avd: string): Promise<string> {
  const emulatorBin = findEmulatorBinary();
  if (!emulatorBin) {
    throw new VitrineError(
      "E_EMULATOR_BINARY_MISSING",
      "Could not locate the Android `emulator` binary. Set ANDROID_HOME (or " +
        "ANDROID_SDK_ROOT) to your SDK path, or start the emulator manually.",
    );
  }

  const before = new Set((await listDevices()).map((d) => d.serial));

  // Detach so the emulator keeps running for the whole capture session.
  // reject:false + an explicit catch prevent an unhandled rejection if the
  // detached process later exits non-zero (we track readiness via adb instead).
  const child = execa(emulatorBin, ["-avd", avd, "-no-snapshot-save"], {
    detached: true,
    stdio: "ignore",
    reject: false,
  });
  child.catch(() => undefined);
  child.unref();

  // Wait for a new emulator serial to appear.
  let serial: string | undefined;
  const appeared = await waitFor(
    async () => {
      const now = await listDevices();
      const fresh = now.find((d) => isEmulator(d) && !before.has(d.serial));
      if (fresh) {
        serial = fresh.serial;
        return true;
      }
      return false;
    },
    { timeoutMs: BOOT_TIMEOUT_MS, intervalMs: BOOT_POLL_MS },
  );

  if (!appeared || !serial) {
    throw new VitrineError(
      "E_EMULATOR_BOOT_TIMEOUT",
      `Timed out waiting for AVD "${avd}" to start. Check that the AVD name is correct.`,
    );
  }

  await waitForBoot(serial);
  return serial;
}

/** Block until `sys.boot_completed` is 1 for the given serial. */
async function waitForBoot(serial: string): Promise<void> {
  await run("adb", ["-s", serial, "wait-for-device"]).catch(() => undefined);

  const booted = await waitFor(
    async () => {
      const { stdout } = await run(
        "adb",
        ["-s", serial, "shell", "getprop", "sys.boot_completed"],
        { reject: false },
      );
      return stdout.trim() === "1";
    },
    { timeoutMs: BOOT_TIMEOUT_MS, intervalMs: BOOT_POLL_MS },
  );

  if (!booted) {
    throw new VitrineError(
      "E_DEVICE_BOOT_TIMEOUT",
      `Timed out waiting for device "${serial}" to finish booting.`,
    );
  }

  // Small settle delay after boot completes.
  await delay(1_000);
}

function findEmulatorBinary(): string | undefined {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) return undefined;
  const candidates = [
    join(sdk, "emulator", "emulator"),
    join(sdk, "emulator", "emulator.exe"),
    join(sdk, "tools", "emulator"),
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * Parse `adb shell ps -A` output to check whether `packageName` has a live
 * process. Matches the last whitespace-separated field (the command column)
 * exactly, so `com.example.app` doesn't false-positive on
 * `com.example.app.dev` or vice versa.
 */
export function parseProcessList(stdout: string, packageName: string): boolean {
  return stdout.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/);
    return fields[fields.length - 1] === packageName;
  });
}

/**
 * Check whether the app's process is currently alive on the device.
 */
export async function isProcessRunning(
  serial: string,
  packageName: string,
): Promise<boolean> {
  try {
    const { stdout } = await run("adb", ["-s", serial, "shell", "ps", "-A"], {
      reject: false,
    });
    return parseProcessList(stdout, packageName);
  } catch {
    return true;
  }
}

/**
 * Ensure the app under test is present on the device: install the APK when
 * `apkPath` is set, otherwise verify the package is already installed.
 */
export async function ensureApp(
  app: Config["app"],
  serial: string,
): Promise<void> {
  if (app.apkPath) {
    if (!existsSync(app.apkPath)) {
      throw new VitrineError(
        "E_APK_NOT_FOUND",
        `APK not found at ${app.apkPath}.`,
      );
    }
    await run("adb", ["-s", serial, "install", "-r", app.apkPath]);
    return;
  }

  const { stdout } = await run(
    "adb",
    ["-s", serial, "shell", "pm", "list", "packages", app.packageName],
    { reject: false },
  );
  const installed = stdout
    .split(/\r?\n/)
    .some((line) => line.trim() === `package:${app.packageName}`);

  if (!installed) {
    throw new VitrineError(
      "E_APP_NOT_INSTALLED",
      `Package "${app.packageName}" is not installed on ${serial}. Install your dev client / APK first, or set app.apkPath in the config.`,
    );
  }
}

// Generous on purpose: on Windows, Node's fetch/undici has been observed
// taking ~1.5-2s to reach a loopback HTTP server
const METRO_PROBE_TIMEOUT_MS = 10_000;

/**
 * Forward the host's Metro port onto the device (`adb reverse`) so a dev build
 * can reach the bundler at localhost. Booting an emulator loses any prior
 * reverse mapping, so capture re-establishes it every run.
 */
export async function setupMetroReverse(
  serial: string,
  port: number,
): Promise<void> {
  await run("adb", ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
}

/** Android package names are restricted to this charset by the OS itself. */
const PACKAGE_NAME_RE = /^[a-zA-Z0-9_.]+$/;

/**
 * Force a Metro-backed debug build to resolve the bundler via `localhost`
 * instead of the emulator's default `10.0.2.2` NAT alias. Large chunked
 * bundle-download responses can get corrupted in transit over that NAT path,
 * which hangs the app on the splash screen forever with no error surfaced.
 *
 * Writes `debug_http_host` directly into the app's own SharedPreferences via
 * `run-as` — no `adb root` required (unlike the `metro.host` system property
 * approach), so this works against any debuggable build, not just
 * rootable emulator images.
 */
export async function overrideMetroHost(
  serial: string,
  packageName: string,
  port: number,
): Promise<void> {
  if (!PACKAGE_NAME_RE.test(packageName)) {
    throw new VitrineError(
      "E_INVALID_PACKAGE_NAME",
      `Invalid app.packageName "${packageName}" — expected an Android package name (letters, digits, "_", "." only).`,
    );
  }

  await run("adb", [
    "-s",
    serial,
    "shell",
    "run-as",
    packageName,
    "mkdir",
    "-p",
    "shared_prefs",
  ]);

  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map><string name="debug_http_host">localhost:${port}</string></map>\n`;

  // `adb shell` joins its remaining args with spaces before sending them to
  // the device's shell, so the `run-as ... sh -c "..."` command must be built
  // as a single pre-quoted argv entry — otherwise the `>` redirect would be
  // parsed by the outer `run-as` invocation instead of the inner `sh -c`.
  await run(
    "adb",
    [
      "-s",
      serial,
      "shell",
      `run-as ${packageName} sh -c "cat > shared_prefs/${packageName}_preferences.xml"`,
    ],
    { input: xml },
  );
}

/**
 * Verify Metro is running on the host. Expo / React Native dev builds load
 * their JS bundle from Metro at runtime; without it the app hangs on the splash
 * screen and every capture is a splash. Fail loudly instead.
 */
export async function assertMetroRunning(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/status`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METRO_PROBE_TIMEOUT_MS);

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch {
    throw new VitrineError(
      "E_METRO_UNREACHABLE",
      `Metro dev server is not reachable at ${url}. Dev builds load their JS bundle from Metro — start it with \`npx expo start\` and keep it running, then re-run capture. For a standalone release/preview APK that embeds the bundle, set device.devServer to false.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new VitrineError(
      "E_METRO_UNEXPECTED_RESPONSE",
      `Got HTTP ${res.status} from ${url}, which doesn't look like Metro — is another process using port ${port}? Stop it (or set device.metroPort), then re-run capture.`,
    );
  }

  const body = await res.text();
  if (!body.includes("packager-status:running")) {
    throw new VitrineError(
      "E_METRO_NOT_READY",
      `Metro responded at ${url} but is not ready (expected "packager-status:running"). Wait for \`npx expo start\` to finish booting, then re-run capture.`,
    );
  }
}

/**
 * Parse the output of `adb shell cmd uimode night`, e.g. `"Night mode: no"`.
 * Returns the raw mode lowercased so it can be handed straight back to
 * `setNightMode` — devices also report `auto` and `custom_schedule`, not just
 * `yes`/`no`. Returns undefined when the output isn't recognizable (an older
 * system image without the `night` subcommand). Pure — unit tested directly.
 */
export function parseNightMode(stdout: string): string | undefined {
  const match = /night mode:\s*(\S+)/i.exec(stdout);
  return match?.[1]?.toLowerCase();
}

/**
 * Read the device's current night mode so capture can restore it afterwards.
 * Never throws: an unreadable mode just means the caller skips the restore
 * rather than guessing a value and clobbering the user's setting.
 */
export async function getNightMode(
  serial: string,
): Promise<string | undefined> {
  const { stdout } = await run(
    "adb",
    ["-s", serial, "shell", "cmd", "uimode", "night"],
    { reject: false },
  );
  return parseNightMode(stdout);
}

/**
 * Put the device into `yes` (dark), `no` (light), or a mode previously read by
 * {@link getNightMode}. The app must follow the system appearance for this to
 * change anything on screen.
 */
export async function setNightMode(
  serial: string,
  mode: string,
): Promise<void> {
  try {
    await run("adb", ["-s", serial, "shell", "cmd", "uimode", "night", mode]);
  } catch (error) {
    throw new VitrineError(
      "E_NIGHT_MODE_UNSUPPORTED",
      `Failed to set night mode "${mode}" on ${serial}. \`cmd uimode night\` requires Android 10 (API 29) or newer — check the AVD's system image. Original error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}
