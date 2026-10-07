import { describe, expect, it } from "vitest";
import { blockKey, blockStart, blocksForWindow } from "../lib/logs";

const at = (iso: string) => Date.parse(iso);

describe("blockKey / blockStart", () => {
  it("uses the UTC day, not the local one", () => {
    expect(blockKey(at("2026-08-28T23:59:59Z"))).toBe("2026-08-28");
    expect(blockKey(at("2026-08-29T00:00:00Z"))).toBe("2026-08-29");
  });

  it("blockStart is the inverse at midnight UTC", () => {
    expect(blockStart("2026-08-28")).toBe(at("2026-08-28T00:00:00Z"));
  });
});

describe("blocksForWindow", () => {
  it("returns newest first", () => {
    const keys = blocksForWindow(at("2026-08-26T10:00:00Z"), at("2026-08-28T10:00:00Z"));
    expect(keys).toEqual(["2026-08-28", "2026-08-27", "2026-08-26"]);
  });

  it("last 24 hours at 09:00 needs yesterday's block too", () => {
    const now = at("2026-08-28T09:00:00Z");
    const keys = blocksForWindow(now - 86_400_000, now);
    expect(keys).toEqual(["2026-08-28", "2026-08-27"]);
  });

  it("a window inside one day is one block", () => {
    const keys = blocksForWindow(at("2026-08-28T14:00:00Z"), at("2026-08-28T14:05:00Z"));
    expect(keys).toEqual(["2026-08-28"]);
  });

  it("a window ending exactly at midnight includes the new day's block", () => {
    const keys = blocksForWindow(at("2026-08-28T12:00:00Z"), at("2026-08-29T00:00:00Z"));
    expect(keys).toEqual(["2026-08-29", "2026-08-28"]);
  });

  it("a window starting exactly at midnight excludes the previous day", () => {
    const keys = blocksForWindow(at("2026-08-28T00:00:00Z"), at("2026-08-28T06:00:00Z"));
    expect(keys).toEqual(["2026-08-28"]);
  });
});
