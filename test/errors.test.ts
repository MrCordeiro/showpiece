import { describe, expect, it } from "vitest";
import {
  ShowpieceError,
  UNKNOWN_ERROR_CODE,
  errorInfo,
} from "../src/util/errors.js";

describe("ShowpieceError", () => {
  it("carries a code alongside the message", () => {
    const error = new ShowpieceError("E_TOOL_MISSING", "maestro not found");
    expect(error.code).toBe("E_TOOL_MISSING");
    expect(error.message).toBe("maestro not found");
    expect(error).toBeInstanceOf(Error);
  });

  it("chains a cause when provided", () => {
    const cause = new Error("root cause");
    const error = new ShowpieceError("E_NIGHT_MODE_UNSUPPORTED", "failed", {
      cause,
    });
    expect(error.cause).toBe(cause);
  });
});

describe("errorInfo", () => {
  it("reads the code off a ShowpieceError", () => {
    const error = new ShowpieceError("E_CONFIG_INVALID", "bad config");
    expect(errorInfo(error)).toEqual({
      code: "E_CONFIG_INVALID",
      message: "bad config",
    });
  });

  it("falls back to E_UNKNOWN for a plain Error", () => {
    expect(errorInfo(new Error("boom"))).toEqual({
      code: UNKNOWN_ERROR_CODE,
      message: "boom",
    });
  });

  it("falls back to E_UNKNOWN for a non-Error throw", () => {
    expect(errorInfo("boom")).toEqual({
      code: UNKNOWN_ERROR_CODE,
      message: "boom",
    });
  });
});
