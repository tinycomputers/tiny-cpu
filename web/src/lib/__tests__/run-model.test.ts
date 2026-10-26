import { describe, expect, it } from "vitest";
import { buildRunModel, DATA_BASE } from "../run-model";
import type { CycleState, Retire } from "../state-schema";

const retire = (over: Partial<Retire>): Retire => ({
  order: 0, pc: 0, insn: 0, rdAddr: 0, rdWdata: 0, pcWdata: 4, memAddr: 0, memRmask: 0, memWmask: 0,
  memRdata: 0, memWdata: 0, misaligned: false, halt: false, cycleDep: false, ...over,
});

const state = (cycle: number, over: Partial<CycleState> = {}, hz: Partial<CycleState["hazard"]> = {}): CycleState => ({
  cycle,
  halted: false,
  fault: false,
  stages: ["IF", "ID", "EX", "MEM", "WB"].map((name) => ({ name, valid: false, pc: 0, insn: 0 })) as CycleState["stages"],
  hazard: { stall: false, loadUse: false, flushIFID: false, flushIDEX: false, fwdA: 0, fwdB: 0, ...hz },
  regs: Array(32).fill(0),
  retired: null,
  console: null,
  tohost: null,
  counters: { cycle, instret: 0 },
  ...over,
});

describe("run model", () => {
  it("counts retires, stalls, flushes and forwards cumulatively", () => {
    const states = [
      state(1),
      state(2, {}, { stall: true, loadUse: true }),
      state(3, { retired: retire({ order: 0 }) }, { flushIFID: true, fwdA: 2 }),
      state(4, { retired: retire({ order: 1 }) }, { fwdB: 1 }),
    ];
    const m = buildRunModel(states, new Uint8Array(4096));
    expect(m.stats(3)).toMatchObject({ cycles: 4, instret: 2, stalls: 1, loadUse: 1, flushes: 1, forwards: 2 });
    expect(m.stats(3).cpi).toBe(2);
    expect(m.stats(0).instret).toBe(0);
  });

  it("replays data memory from retired stores, honouring byte lanes and skipping MMIO", () => {
    const init = new Uint8Array(4096).fill(0x11);
    const states = [
      state(1, { retired: retire({ memAddr: DATA_BASE, memWmask: 0b0010, memWdata: 0x0000_aa00 }) }),
      state(2, { retired: retire({ memAddr: 0x0002_0000, memWmask: 1, memWdata: 0x41 }) }),
      state(3, { retired: retire({ memAddr: DATA_BASE + 4, memWmask: 0b1111, memWdata: 0x0403_0201 }) }),
    ];
    const m = buildRunModel(states, init);
    expect(Array.from(m.memoryAt(0).subarray(0, 4))).toEqual([0x11, 0xaa, 0x11, 0x11]);
    expect(Array.from(m.memoryAt(1).subarray(0, 4))).toEqual([0x11, 0xaa, 0x11, 0x11]);
    expect(Array.from(m.memoryAt(2).subarray(4, 8))).toEqual([1, 2, 3, 4]);
    // moving backwards replays from the initial image
    expect(Array.from(m.memoryAt(0).subarray(4, 8))).toEqual([0x11, 0x11, 0x11, 0x11]);
  });

  it("accumulates console output up to a cycle", () => {
    const states = [state(1, { console: 72 }), state(2), state(3, { console: 105 })];
    const m = buildRunModel(states, new Uint8Array(4096));
    expect(m.consoleAt(0)).toBe("H");
    expect(m.consoleAt(2)).toBe("Hi");
  });
});
