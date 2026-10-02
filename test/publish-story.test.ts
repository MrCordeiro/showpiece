import { describe, expect, it } from "vitest";
import type { CheckedItem } from "../src/publish/listing.js";
import { formatStoryTable } from "../src/publish/story.js";

const items: CheckedItem[] = [
  {
    kind: "framed",
    position: 1,
    entry: "home.png",
    path: "/x/framed/home.png",
    screen: { id: "home", flow: "home.yaml", caption: "Track everything" },
    variantId: "home",
    status: "ok",
  },
  {
    kind: "external",
    position: 2,
    entry: "./marketing/a.png",
    path: "/x/marketing/a.png",
    status: "ok",
  },
  {
    kind: "unknown",
    position: 3,
    entry: "hom.png",
    path: "/x/framed/hom.png",
    status: "missing",
    detail: 'Did you mean "home.png"?',
  },
];

describe("formatStoryTable", () => {
  it("prints one numbered row per entry with its status and caption or detail", () => {
    const lines = formatStoryTable(items).split("\n");
    expect(lines[0]).toBe("Store listing (3 screenshots)");
    expect(lines[2]).toMatch(/^✓ 1 {2}home\.png +ok +Track everything$/);
    expect(lines[3]).toMatch(
      /^✓ 2 {2}\.\/marketing\/a\.png +ok +External image, uploaded as it is$/,
    );
    expect(lines[4]).toMatch(
      /^✗ 3 {2}hom\.png +missing +Did you mean "home\.png"\?$/,
    );
  });

  it("marks a stale entry with !", () => {
    const stale: CheckedItem = {
      ...items[1],
      status: "stale",
      detail: "Old",
    } as CheckedItem;
    expect(formatStoryTable([stale]).split("\n")[2]).toMatch(/^! 2 /);
  });
});
