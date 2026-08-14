/**
 * A vitrine error carrying a stable machine-readable `code` alongside its
 * human-readable `message`. The message text is unchanged from before this
 * taxonomy existed - hint-rich prose stays the primary UX; `code` exists so
 * an agent (or `last-run.json`) can branch on failure kind without parsing
 * prose. See `skills/vitrine-flows/SKILL.md` for the code → fix-recipe table.
 */
export class VitrineError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "VitrineError";
    this.code = code;
    this.details = options?.details;
  }
}

/** Fallback code for an error not raised as a {@link VitrineError}. */
export const UNKNOWN_ERROR_CODE = "E_UNKNOWN";

/**
 * Normalize any thrown value into `{ code, message }`. `VitrineError`s report
 * their own code; anything else (a plain `Error`, a rejected promise's
 * non-Error value, etc.) reports {@link UNKNOWN_ERROR_CODE}.
 */
export function errorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof VitrineError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: UNKNOWN_ERROR_CODE,
    message: error instanceof Error ? error.message : String(error),
  };
}
