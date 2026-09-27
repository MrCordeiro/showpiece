import { z } from "zod";

/** Hex color like `#1a1a2e` or `#fff`. */
const hexColor = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    "must be a hex color such as #1a1a2e or #fff",
  );

export const frameTemplateSchema = z.enum(["gradient", "solid", "minimal"]);
export type FrameTemplate = z.infer<typeof frameTemplateSchema>;

export const appearanceSchema = z.enum(["light", "dark"]);
export type Appearance = z.infer<typeof appearanceSchema>;

export const screenSchema = z.object({
  /** Stable screen id; must equal the flow's `takeScreenshot` name. */
  id: z.string().min(1, "screen id must not be empty"),
  /** Path to the Maestro flow (relative to the config file). */
  flow: z.string().min(1, "screen flow path must not be empty"),
  caption: z.string().default(""),
});
export type ScreenConfig = z.infer<typeof screenSchema>;

export const configSchema = z.object({
  app: z.object({
    packageName: z.string().min(1, "app.packageName is required"),
    /** Optional; if omitted the app is assumed already installed. */
    apkPath: z.string().min(1).optional(),
  }),
  device: z.object({
    avd: z.string().min(1, "device.avd is required"),
    locale: z.string().default("en-US"),
    /**
     * Whether the installed build is a Metro-backed dev build (Expo dev client
     * or `expo run:android` debug). When true, capture forwards the Metro port
     * to the device and verifies Metro is running before capturing. Set false
     * for a standalone release/preview APK that embeds the JS bundle.
     */
    devServer: z.boolean().default(true),
    /** Metro bundler port (forwarded via `adb reverse`). */
    metroPort: z.number().int().min(1).max(65535).default(8081),
  }),
  frame: z
    .object({
      template: frameTemplateSchema.default("gradient"),
      /** Solid color, or a two-stop linear gradient. */
      background: z.union([hexColor, z.tuple([hexColor, hexColor])]),
      textColor: hexColor.default("#ffffff"),
      /** v0 ships exactly one bundled font — see src/frame/font.ts. */
      font: z.enum(["Inter"]).default("Inter"),
    })
    .superRefine((frame, ctx) => {
      if (frame.template === "solid" && Array.isArray(frame.background)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'template "solid" requires a single background color, not a two-stop gradient — use frame.background: "#rrggbb"',
          path: ["background"],
        });
      }
    }),
  publish: z.object({
    serviceAccountKeyPath: z
      .string()
      .min(1, "publish.serviceAccountKeyPath is required"),
    /** Images only today; reserved for clarity. */
    track: z.string().default("listing"),
  }),
  /** Base dir for capture/frame output */
  screenshotsDir: z
    .string()
    .min(1, "screenshotsDir must not be empty")
    .default(".vitrine/screenshots"),
  /**
   * System UI mode the device is put into before capturing. `"dark"` also
   * suffixes every output file with `-dark`, so both appearances can coexist
   * in one output dir. Requires the app itself to follow the system
   * appearance (Expo: `userInterfaceStyle: "automatic"` — the Expo default is
   * `"light"`, which ignores the system setting entirely).
   */
  appearance: appearanceSchema.default("light"),
  screens: z
    .array(screenSchema)
    .min(1, "at least one screen is required")
    .superRefine((screens, ctx) => {
      const seen = new Set<string>();
      screens.forEach((screen, index) => {
        if (seen.has(screen.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate screen id "${screen.id}"`,
            path: [index, "id"],
          });
        }
        seen.add(screen.id);
      });
    }),
});

/** Author-facing shape (defaults optional). */
export type ConfigInput = z.input<typeof configSchema>;
/** Validated, fully-defaulted config the CLI operates on. */
export type Config = z.output<typeof configSchema>;

/**
 * Identity helper that gives editor autocompletion / type-checking to a
 * `vitrine.config.ts`. Validation happens at load time via {@link configSchema}.
 */
export function defineConfig(config: ConfigInput): ConfigInput {
  return config;
}
