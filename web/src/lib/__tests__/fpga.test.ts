import { describe, expect, it } from "vitest";
import { cyclesToMicroseconds, ICE40_FMAX_MHZ } from "../fpga";

describe("fpga timing", () => {
  it("converts cycles to microseconds at the board clock", () => {
    // ICE40_FMAX_MHZ * 1000 cycles take 1000 microseconds at that clock.
    expect(cyclesToMicroseconds(ICE40_FMAX_MHZ * 1000)).toBeCloseTo(1000, 6);
    expect(cyclesToMicroseconds(15, 15)).toBe(1);
    expect(cyclesToMicroseconds(0)).toBe(0);
  });

  it("is a plausible clock for the iCE40UP5K pipeline", () => {
    expect(ICE40_FMAX_MHZ).toBeGreaterThan(12); // above the 12 MHz oscillator the board runs at
    expect(ICE40_FMAX_MHZ).toBeLessThan(50);
  });
});
