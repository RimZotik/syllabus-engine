import { describe, expect, it } from "vitest";
import { fmtTime } from "../format";

describe("fmtTime", () => {
  it("formats study time for the record book", () => {
    expect(fmtTime(0)).toBe("0 мин");
    expect(fmtTime(20)).toBe("меньше минуты");
    expect(fmtTime(12 * 60)).toBe("12 мин");
    expect(fmtTime(60 * 60)).toBe("1 ч");
    expect(fmtTime(85 * 60)).toBe("1 ч 25 мин");
  });
});
