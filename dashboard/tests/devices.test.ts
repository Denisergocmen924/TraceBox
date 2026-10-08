import { describe, expect, it } from "vitest";
import {
  canStream,
  deviceStatus,
  isSilent,
  OFFLINE_AFTER_SECONDS,
  type Device,
} from "../lib/devices";

const NOW = Date.parse("2026-10-07T12:00:00Z");

/** `seconds` saniye önce görülmüş bir cihaz; diğer alanlar sağlıklı varsayılan. */
function device(overrides: Partial<Device> & { seenAgo?: number | null } = {}): Device {
  const { seenAgo = 5, ...rest } = overrides;
  return {
    id: "d1",
    device_name: "test-vm",
    os_name: null,
    os_version: null,
    arch: null,
    cpu_cores_logical: null,
    ram_total_mb: null,
    disk_total_mb: null,
    agent_version: null,
    last_boot: null,
    logging_enabled: true,
    last_seen: seenAgo == null ? null : new Date(NOW - seenAgo * 1000).toISOString(),
    enabled_addons: [],
    latest: null,
    deletePending: false,
    ...rest,
  };
}

describe("isSilent", () => {
  it("is not silent exactly at the threshold", () => {
    expect(isSilent(device({ seenAgo: OFFLINE_AFTER_SECONDS }), NOW)).toBe(false);
  });

  it("is silent one second past the threshold", () => {
    expect(isSilent(device({ seenAgo: OFFLINE_AFTER_SECONDS + 1 }), NOW)).toBe(true);
  });

  it("treats a never-seen device as silent", () => {
    expect(isSilent(device({ seenAgo: null }), NOW)).toBe(true);
  });
});

describe("deviceStatus priority", () => {
  it("is online for a healthy device", () => {
    expect(deviceStatus(device(), NOW)).toBe("online");
  });

  it("is paused when the device talks but logging is off", () => {
    expect(deviceStatus(device({ logging_enabled: false }), NOW)).toBe("paused");
  });

  it("offline beats paused", () => {
    const d = device({ logging_enabled: false, seenAgo: 600 });
    expect(deviceStatus(d, NOW)).toBe("offline");
  });

  it("deleting beats offline", () => {
    const d = device({ deletePending: true, seenAgo: 600 });
    expect(deviceStatus(d, NOW)).toBe("deleting");
  });

  it("deleting beats paused", () => {
    const d = device({ deletePending: true, logging_enabled: false });
    expect(deviceStatus(d, NOW)).toBe("deleting");
  });
});

describe("canStream", () => {
  it("is true for a healthy device", () => {
    expect(canStream(device(), NOW)).toBe(true);
  });

  it("is false when paused, even though the device is not silent", () => {
    expect(canStream(device({ logging_enabled: false }), NOW)).toBe(false);
  });

  it("is false when silent", () => {
    expect(canStream(device({ seenAgo: 600 }), NOW)).toBe(false);
  });

  it("stays true while a delete is pending, because the agent still ships", () => {
    expect(canStream(device({ deletePending: true }), NOW)).toBe(true);
  });
});
