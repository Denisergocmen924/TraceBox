import { describe, expect, it } from "vitest";
import { relativeTime } from "../lib/time";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

describe("relativeTime", () => {
  it("says never seen for null", () => {
    expect(relativeTime(null, NOW)).toBe("never seen");
  });

  it("picks the right unit at each boundary", () => {
    expect(relativeTime(ago(59), NOW)).toBe("59s ago");
    expect(relativeTime(ago(60), NOW)).toBe("1m ago");
    expect(relativeTime(ago(3599), NOW)).toBe("59m ago");
    expect(relativeTime(ago(3600), NOW)).toBe("1h ago");
    expect(relativeTime(ago(86_399), NOW)).toBe("23h ago");
    expect(relativeTime(ago(86_400), NOW)).toBe("1d ago");
  });

  it("never goes negative when the clock is slightly behind", () => {
    expect(relativeTime(ago(-30), NOW)).toBe("0s ago");
  });
});
