import { describe, expect, it } from "vitest";
import {
  SERIES_BY_KEY,
  formatAmount,
  hardwareTracks,
  usageText,
  type MetricBucket,
} from "../lib/metrics";
import type { LatestMetric } from "../lib/devices";

const RAM_MB = 2048;
const DISK_MB = 10240;

describe("formatAmount", () => {
  it("1024 MB ve üstünü GB, altını MB yazar", () => {
    expect(formatAmount(1023)).toBe("1,023 MB");
    expect(formatAmount(1024)).toBe("1 GB");
    expect(formatAmount(447)).toBe("447 MB");
    expect(formatAmount(1229)).toBe("1.2 GB");
  });
});

describe("usageText", () => {
  it("CPU yalnızca yüzdedir, kapasite verilse de", () => {
    expect(usageText("cpu", 34.2, RAM_MB)).toBe("34%");
  });

  it("RAM ve disk yüzdeyi önce, mutlak değeri parantez içinde yazar", () => {
    expect(usageText("ram", 62.5, RAM_MB)).toBe("63% (1.3 GB)");
    expect(usageText("disk", 61, DISK_MB)).toBe("61% (6.1 GB)");
    expect(usageText("ram", 10, 2048)).toBe("10% (205 MB)");
  });

  it("kapasite yoksa mutlak değer uydurmaz, NaN yazmaz", () => {
    expect(usageText("ram", 50, null)).toBe("50%");
    expect(usageText("disk", 50, 0)).toBe("50%");
    expect(usageText("disk", 50, undefined)).toBe("50%");
  });

  it("ölçüm yoksa tire yazar", () => {
    expect(usageText("ram", null, RAM_MB)).toBe("—");
    expect(usageText("cpu", undefined, null)).toBe("—");
  });
});

const latest = (o: Partial<LatestMetric>) =>
  ({ cpu_percent: null, ram_used_mb: null, disk_percent: null, ...o }) as LatestMetric;

describe("SERIES display (kart)", () => {
  it("RAM kullanılan MB'yi yüzdeye çevirir", () => {
    const m = latest({ ram_used_mb: 1024 });
    expect(SERIES_BY_KEY.ram.display(m, RAM_MB, DISK_MB)).toBe("50% (1 GB)");
  });

  it("RAM toplamı yoksa tire yazar (yüzde hesaplanamaz)", () => {
    const m = latest({ ram_used_mb: 1024 });
    expect(SERIES_BY_KEY.ram.display(m, null, DISK_MB)).toBe("—");
  });

  it("disk toplamı yoksa yalnızca yüzde yazar", () => {
    const m = latest({ disk_percent: 61 });
    expect(SERIES_BY_KEY.disk.display(m, RAM_MB, null)).toBe("61%");
    expect(SERIES_BY_KEY.disk.display(m, RAM_MB, DISK_MB)).toBe("61% (6.1 GB)");
  });
});

describe("hardwareTracks format (lejant / tooltip)", () => {
  const bucket = {
    bucket_start: "2026-10-07T12:00:00Z",
    samples: 1,
    cpu_min: 10, cpu_max: 30, cpu_avg: 20,
    ram_min: 512, ram_max: 1024, ram_avg: 768,
    disk_min: 60, disk_max: 62, disk_avg: 61,
  } as MetricBucket;

  const fmt = (key: string, ram: number | null, disk: number | null, v: number) =>
    hardwareTracks([bucket], ram, disk, 60_000)
      .find((t) => t.key === key)!
      .format(v);

  it("üç iz de kartla aynı biçimi kullanır", () => {
    expect(fmt("cpu", RAM_MB, DISK_MB, 20)).toBe("20%");
    expect(fmt("ram", RAM_MB, DISK_MB, 1024)).toBe("50% (1 GB)");
    expect(fmt("disk", RAM_MB, DISK_MB, 61)).toBe("61% (6.1 GB)");
  });

  it("disk toplamı yokken disk izi yalnızca yüzde yazar", () => {
    expect(fmt("disk", RAM_MB, null, 61)).toBe("61%");
  });
});
