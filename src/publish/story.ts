import type { CheckedItem } from "./listing.js";

function mark(item: CheckedItem): string {
  if (item.status === "ok") return "✓";
  if (item.status === "stale") return "!";
  return "✗";
}

function note(item: CheckedItem): string {
  if (item.detail) return item.detail;
  if (item.kind === "framed") return item.screen.caption;
  if (item.kind === "external") return "External image, uploaded as it is";
  return "";
}

export function formatStoryTable(items: CheckedItem[]): string {
  const title = `Store listing (${items.length} screenshots)`;
  const positionWidth = String(items.length).length;
  const entryWidth = Math.max(...items.map((item) => item.entry.length), 0);
  const statusWidth = Math.max(...items.map((item) => item.status.length), 0);
  const rows = items.map((item) =>
    [
      mark(item),
      String(item.position).padStart(positionWidth),
      "",
      item.entry.padEnd(entryWidth),
      "",
      item.status.padEnd(statusWidth),
      "",
      note(item),
    ]
      .join(" ")
      .trimEnd(),
  );
  return `${[title, "-".repeat(title.length), ...rows].join("\n")}\n`;
}
