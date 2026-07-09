import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../src/http/logging.js";

const noop = () => undefined;

describe("structured logging", () => {
  const logSpy = vi.spyOn(console, "log");
  const warnSpy = vi.spyOn(console, "warn");
  const errorSpy = vi.spyOn(console, "error");

  beforeEach(() => {
    logSpy.mockImplementation(noop as never);
    warnSpy.mockImplementation(noop as never);
    errorSpy.mockImplementation(noop as never);
  });
  afterEach(() => {
    logSpy.mockReset();
    warnSpy.mockReset();
    errorSpy.mockReset();
  });

  function firstArg(spy: { mock: { calls: unknown[][] } }): string {
    const call = spy.mock.calls[0];
    if (!call) throw new Error("no call recorded");
    return String(call[0]);
  }

  it("info emits a json line with level + msg + ctx", () => {
    log.info("hello", { ticketId: "01H" });
    const parsed = JSON.parse(firstArg(logSpy));
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.ticketId).toBe("01H");
  });

  it("warn → console.warn", () => {
    log.warn("careful");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(firstArg(warnSpy)).level).toBe("warn");
  });

  it("error → console.error", () => {
    log.error("boom", { reason: "x" });
    expect(errorSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(firstArg(errorSpy));
    expect(parsed.level).toBe("error");
    expect(parsed.reason).toBe("x");
  });
});
