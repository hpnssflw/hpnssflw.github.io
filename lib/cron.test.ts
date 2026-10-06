import { describe, expect, it } from "vitest";
import { nextRun, parseCron } from "./cron";

describe("parseCron", () => {
  it("reads every-N-hours schedules", () => {
    expect(parseCron("0 */4 * * *")).toEqual({ minute: 0, hourStep: 4, hour: null });
    expect(parseCron(" 15 */6 * * * ")).toEqual({ minute: 15, hourStep: 6, hour: null });
  });

  it("reads daily schedules", () => {
    expect(parseCron("30 6 * * *")).toEqual({ minute: 30, hourStep: null, hour: 6 });
  });

  it.each(["0 */4 * * 1", "*/5 * * * *", "0 4,8 * * *", "0 */0 * * *", "60 */4 * * *", "0 * * * *", "nonsense"])(
    "rejects %s",
    (expr) => {
      expect(() => parseCron(expr)).toThrow(/unsupported cron/);
    },
  );
});

describe("nextRun", () => {
  const every4h = parseCron("0 */4 * * *");

  it("finds the next slot after a manual run", () => {
    expect(nextRun(every4h, new Date("2026-10-05T18:22:00Z")).toISOString()).toBe("2026-10-05T20:00:00.000Z");
  });

  it("crosses midnight", () => {
    expect(nextRun(every4h, new Date("2026-10-05T22:30:00Z")).toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("is strictly after now when now is a slot", () => {
    expect(nextRun(every4h, new Date("2026-10-05T20:00:00Z")).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(nextRun(every4h, new Date("2026-10-05T19:59:59Z")).toISOString()).toBe("2026-10-05T20:00:00.000Z");
  });

  it("honours the minute", () => {
    const at15 = parseCron("15 */6 * * *");
    expect(nextRun(at15, new Date("2026-10-05T06:10:00Z")).toISOString()).toBe("2026-10-05T06:15:00.000Z");
    expect(nextRun(at15, new Date("2026-10-05T06:20:00Z")).toISOString()).toBe("2026-10-05T12:15:00.000Z");
  });

  it("handles daily schedules", () => {
    const daily = parseCron("30 6 * * *");
    expect(nextRun(daily, new Date("2026-10-05T06:00:00Z")).toISOString()).toBe("2026-10-05T06:30:00.000Z");
    expect(nextRun(daily, new Date("2026-10-05T07:00:00Z")).toISOString()).toBe("2026-10-06T06:30:00.000Z");
  });
});
