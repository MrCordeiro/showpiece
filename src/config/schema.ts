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

/** Solid color, or a two-stop linear gradient. */
const backgroundSchema = z.union([hexColor, z.tuple([hexColor, hexColor])]);

export const screenSchema = z.object({
  /** Stable screen id; must equal the flow's `takeScreenshot` name. */
  id: z.string().min(1, "screen id must not be empty"),
  /** Path to the Maestro flow (relative to the config file). */
  flow: z.string().min(1, "screen flow path must not be empty"),
  caption: z.string().default(""),
  subtitle: z.string().optional(),
  /** Overrides `frame.background` for this screen. */
  background: backgroundSchema.optional(),
  /** Overrides `frame.textColor` for this screen. */
  textColor: hexColor.optional(),
});
export type ScreenConfig = z.infer<typeof screenSchema>;

export const configSchema = z
  .object({
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
        /** Default for every screen without its own `background`. */
        background: backgroundSchema,
        textColor: hexColor.default("#ffffff"),
        /** Must list exactly the keys of FONTS in src/frame/font.ts. */
        font: z.enum(["Metropolis", "Inter"]).default("Metropolis"),
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
      /**
       * `publish` checks the entry names and the 2–8 count, not this schema,
       * so that a listing mistake never stops `capture` or `frame`.
       */
      listing: z
        .array(z.string().min(1, "publish.listing entries must not be empty"))
        .optional(),
    }),
    /** Base dir for capture/frame output */
    screenshotsDir: z
      .string()
      .min(1, "screenshotsDir must not be empty")
      .default(".vitrine/screenshots"),
    /**
     * Base dir for per-screen troubleshooting evidence (Maestro's failure
     * screenshot, view hierarchy, command log). Same lifecycle as `raw/`: a run
     * only writes the screens it attempted, replacing that screen's previous
     * directory. See `<diagnosticsDir>/last-run.json` for the machine-readable
     * summary of the most recent run.
     */
    diagnosticsDir: z
      .string()
      .min(1, "diagnosticsDir must not be empty")
      .default(".vitrine/diagnostics"),
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
  })
  .superRefine((config, ctx) => {
    if (config.frame.template !== "solid") return;
    config.screens.forEach((screen, index) => {
      if (Array.isArray(screen.background)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'template "solid" requires a single background color, not a two-stop gradient — use background: "#rrggbb"',
          path: ["screens", index, "background"],
        });
      }
    });
  });

/** Author-facing shape (defaults optional). */
export type ConfigInput = z.input<typeof configSchema>;
/** Validated, fully-defaulted config the CLI operates on. */
export type Config = z.output<typeof configSchema>;

type PathSeparator = "/" | "\\";

/** A `publish.listing` entry for an image that vitrine did not make. It is relative to the config file. */
export type ExternalListingPath =
  | `.${PathSeparator}${string}`
  | `..${PathSeparator}${string}`;

/** A framed file name for a screen in `screens`, or an external path. */
export type ListingEntry<Id extends string = string> =
  | `${Id}.png`
  | `${Id}-dark.png`
  | ExternalListingPath;

type ScreenInput = z.input<typeof screenSchema>;

/**
 * Identity helper that gives editor autocompletion / type-checking to a
 * `vitrine.config.ts`. Validation happens at load time via {@link configSchema}.
 * `Id` is inferred only from `screens[].id`. `NoInfer` stops a misspelled
 * `listing` entry from adding a new id, so the editor reports the typo.
 */
export function defineConfig<const Id extends string>(
  config: Omit<ConfigInput, "screens" | "publish"> & {
    screens: (ScreenInput & { id: Id })[];
    publish: ConfigInput["publish"] & {
      listing?: NoInfer<ListingEntry<Id>>[];
    };
  },
): ConfigInput {
  return config;
}
