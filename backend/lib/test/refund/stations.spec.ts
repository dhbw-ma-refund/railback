import { describe, expect, it } from "vitest";
import { STATIONS, listStations, resolveStation } from "../../src/refund/stations.js";

describe("STATIONS", () => {
  it("has 382 entries total (23 cat-1 + 84 cat-2 + 275 cat-3)", () => {
    expect(STATIONS.length).toBe(382);
    expect(STATIONS.filter((s) => s.category === 1).length).toBe(23);
    expect(STATIONS.filter((s) => s.category === 2).length).toBe(84);
    expect(STATIONS.filter((s) => s.category === 3).length).toBe(275);
  });

  it("has unique EVA numbers", () => {
    const evas = new Set(STATIONS.map((s) => s.eva));
    expect(evas.size).toBe(STATIONS.length);
  });

  it("preserves canonical order cat 1 → 3", () => {
    let prev = 0;
    for (const s of STATIONS) {
      expect(s.category).toBeGreaterThanOrEqual(prev);
      prev = s.category;
    }
  });
});

describe("resolveStation", () => {
  it("resolves by exact EVA", () => {
    expect(resolveStation(8000261)?.name).toBe("München Hbf");
    expect(resolveStation(8011160)?.name).toBe("Berlin Hauptbahnhof");
  });

  it("resolves by exact case-insensitive name", () => {
    expect(resolveStation("München Hbf")?.eva).toBe(8000261);
    expect(resolveStation("münchen hbf")?.eva).toBe(8000261);
  });

  it("falls back to substring match, preferring earlier categories", () => {
    // "München" matches München Hbf (cat-1) before München-Pasing (cat-2)
    expect(resolveStation("münchen")?.eva).toBe(8000261);
  });

  it("handles umlauts", () => {
    expect(resolveStation("Mönchengladbach")?.eva).toBe(8000253);
    expect(resolveStation("Köln Hbf")?.eva).toBe(8000207);
  });

  it("returns null for unknown name", () => {
    expect(resolveStation("Atlantis Hbf")).toBeNull();
  });

  it("returns null for unknown EVA", () => {
    expect(resolveStation(99999999)).toBeNull();
  });

  it("returns null for empty / whitespace string", () => {
    expect(resolveStation("")).toBeNull();
    expect(resolveStation("   ")).toBeNull();
  });

  it("trims input", () => {
    expect(resolveStation("  Stuttgart Hbf  ")?.eva).toBe(8000096);
  });
});

describe("listStations", () => {
  it("returns the full list", () => {
    expect(listStations().length).toBe(382);
  });
});
