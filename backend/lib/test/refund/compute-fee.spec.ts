import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/index.js";
import { computeFee } from "../../src/refund/compute-fee.js";

describe("computeFee", () => {
  it("ERSTATTUNG_FAHRKARTE returns fahrkartenpreis verbatim", () => {
    const r = computeFee({
      antragsart: "ERSTATTUNG_FAHRKARTE",
      fahrkartenpreis: "49.90",
      delayMinutes: 0,
    });
    expect(r.erwartete_erstattung).toBe("49.90");
  });

  it("ENTSCHAEDIGUNG_60_119 returns 25% of fahrkartenpreis", () => {
    const r = computeFee({
      antragsart: "ENTSCHAEDIGUNG_60_119",
      fahrkartenpreis: "40.00",
      delayMinutes: 75,
    });
    expect(r.erwartete_erstattung).toBe("10.00");
  });

  it("ENTSCHAEDIGUNG_120_PLUS returns 50% of fahrkartenpreis", () => {
    const r = computeFee({
      antragsart: "ENTSCHAEDIGUNG_120_PLUS",
      fahrkartenpreis: "40.00",
      delayMinutes: 130,
    });
    expect(r.erwartete_erstattung).toBe("20.00");
  });

  it("KOSTEN_ALTERNATIVTRANSPORT returns belegeSumme", () => {
    const r = computeFee({
      antragsart: "KOSTEN_ALTERNATIVTRANSPORT",
      fahrkartenpreis: "40.00",
      delayMinutes: 60,
      belegeSumme: "27.45",
    });
    expect(r.erwartete_erstattung).toBe("27.45");
  });

  it("ENTSCHAEDIGUNG_ZEITKARTE ≥120 min → 10.00 pauschale", () => {
    const r = computeFee({
      antragsart: "ENTSCHAEDIGUNG_ZEITKARTE",
      fahrkartenpreis: "99.00",
      delayMinutes: 130,
      isZeitkarte: true,
    });
    expect(r.erwartete_erstattung).toBe("10.00");
  });

  it("ENTSCHAEDIGUNG_ZEITKARTE 60–119 min → 5.00 pauschale", () => {
    const r = computeFee({
      antragsart: "ENTSCHAEDIGUNG_ZEITKARTE",
      fahrkartenpreis: "99.00",
      delayMinutes: 75,
      isZeitkarte: true,
    });
    expect(r.erwartete_erstattung).toBe("5.00");
  });

  it("mulDecimal half-even: 33.33 * 0.25 = 8.33", () => {
    // 33.33 * 0.25 = 8.3325 → half-even round to 2dp = 8.33 (next digit < 5)
    const r = computeFee({
      antragsart: "ENTSCHAEDIGUNG_60_119",
      fahrkartenpreis: "33.33",
      delayMinutes: 90,
    });
    expect(r.erwartete_erstattung).toBe("8.33");
  });

  it("KOSTEN_ALTERNATIVTRANSPORT without belegeSumme throws ERR_VALIDATION", () => {
    expect(() =>
      computeFee({
        antragsart: "KOSTEN_ALTERNATIVTRANSPORT",
        fahrkartenpreis: "40.00",
        delayMinutes: 60,
      })
    ).toThrow(AppError);
    try {
      computeFee({
        antragsart: "KOSTEN_ALTERNATIVTRANSPORT",
        fahrkartenpreis: "40.00",
        delayMinutes: 60,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("ERR_VALIDATION");
      expect((e as AppError).details?.field).toBe("belegeSumme");
    }
  });

  it("ENTSCHAEDIGUNG_ZEITKARTE under 60 min throws ERR_NO_CLAIM", () => {
    expect(() =>
      computeFee({
        antragsart: "ENTSCHAEDIGUNG_ZEITKARTE",
        fahrkartenpreis: "99.00",
        delayMinutes: 30,
        isZeitkarte: true,
      })
    ).toThrow(AppError);
    try {
      computeFee({
        antragsart: "ENTSCHAEDIGUNG_ZEITKARTE",
        fahrkartenpreis: "99.00",
        delayMinutes: 30,
        isZeitkarte: true,
      });
    } catch (e) {
      expect((e as AppError).code).toBe("ERR_NO_CLAIM");
    }
  });

  it("invalid fahrkartenpreis throws ERR_VALIDATION", () => {
    expect(() =>
      computeFee({
        antragsart: "ERSTATTUNG_FAHRKARTE",
        fahrkartenpreis: "abc",
        delayMinutes: 0,
      })
    ).toThrow(AppError);
  });

  it("service_fee_betrag is the locked 0.75 EUR pauschale (2026-06-24)", () => {
    const r = computeFee({
      antragsart: "ERSTATTUNG_FAHRKARTE",
      fahrkartenpreis: "49.90",
      delayMinutes: 0,
    });
    expect(r.service_fee_betrag).toBe("0.75");
  });

  it("service_fee_betrag is constant across antragsarten + inputs", () => {
    const cases = [
      { antragsart: "ERSTATTUNG_FAHRKARTE", fahrkartenpreis: "10.00", delayMinutes: 0 },
      { antragsart: "ENTSCHAEDIGUNG_60_119", fahrkartenpreis: "40.00", delayMinutes: 75 },
      { antragsart: "ENTSCHAEDIGUNG_120_PLUS", fahrkartenpreis: "40.00", delayMinutes: 130 },
      {
        antragsart: "KOSTEN_ALTERNATIVTRANSPORT",
        fahrkartenpreis: "40.00",
        delayMinutes: 60,
        belegeSumme: "27.45",
      },
      {
        antragsart: "ENTSCHAEDIGUNG_ZEITKARTE",
        fahrkartenpreis: "99.00",
        delayMinutes: 130,
        isZeitkarte: true,
      },
    ] as const;
    for (const c of cases) {
      expect(computeFee(c).service_fee_betrag).toBe("0.75");
    }
  });
});
