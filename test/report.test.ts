import { describe, expect, it, vi } from "vitest";
import { printSummary } from "../src/util/report.js";

describe("printSummary", () => {
  it("labels the summary header with the given label", () => {
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    printSummary("Frame", [
      { id: "home", status: "framed", path: "/x/home.png" },
    ]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Frame summary"));
    spy.mockRestore();
  });

  it("counts failures across arbitrary statuses", () => {
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const failures = printSummary("Capture", [
      { id: "home", status: "captured", path: "/x/home.png" },
      { id: "profile", status: "failed", error: "boom" },
    ]);
    expect(failures).toBe(1);
    spy.mockRestore();
  });

  it("prints the error detail for a failed step", () => {
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    printSummary("Frame", [
      { id: "home", status: "failed", error: "no raw file" },
    ]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("no raw file"));
    spy.mockRestore();
  });
});
