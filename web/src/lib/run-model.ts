// Pure helpers over a finished run: per-cycle statistics, data memory and console at any cycle index.
// Memory is replayed from the retire records (the same rule as the WASM harness's shadow copy), so the
// view at cycle i is exactly what the program had written by the end of that cycle.
import type { CycleState } from "./state-schema";

export const DATA_BASE = 0x0001_0000;

export interface RunStats {
  cycles: number;
  instret: number;
  cpi: number;
  stalls: number;
  loadUse: number;
  flushes: number;
  forwards: number;
}

export interface RunModel {
  states: readonly CycleState[];
  stats(index: number): RunStats;
  memoryAt(index: number): Uint8Array;
  consoleAt(index: number): string;
}

/** Loads and stores to each data word over a whole run; index = (address - DATA_BASE) / 4. */
export function accessCounts(states: readonly CycleState[], dmemBytes: number): { reads: Uint32Array; writes: Uint32Array } {
  const words = Math.ceil(dmemBytes / 4);
  const reads = new Uint32Array(words);
  const writes = new Uint32Array(words);
  for (const s of states) {
    const r = s.retired;
    if (!r || (r.memRmask === 0 && r.memWmask === 0)) continue;
    const idx = (r.memAddr - DATA_BASE) >>> 2;
    if (r.memAddr < DATA_BASE || idx >= words) continue; // MMIO or outside DMEM
    if (r.memRmask) reads[idx] = (reads[idx] ?? 0) + 1;
    if (r.memWmask) writes[idx] = (writes[idx] ?? 0) + 1;
  }
  return { reads, writes };
}

export function buildRunModel(states: readonly CycleState[], initialDmem: Uint8Array): RunModel {
  const n = states.length;
  // Cumulative counters, one entry per state.
  const instret = new Uint32Array(n);
  const stalls = new Uint32Array(n);
  const loadUse = new Uint32Array(n);
  const flushes = new Uint32Array(n);
  const forwards = new Uint32Array(n);
  let ir = 0;
  let st = 0;
  let lu = 0;
  let fl = 0;
  let fw = 0;
  states.forEach((s, i) => {
    if (s.retired) ir++;
    if (s.hazard.stall) st++;
    if (s.hazard.loadUse) lu++;
    if (s.hazard.flushIFID) fl++;
    if (s.hazard.fwdA || s.hazard.fwdB) fw++;
    instret[i] = ir;
    stalls[i] = st;
    loadUse[i] = lu;
    flushes[i] = fl;
    forwards[i] = fw;
  });

  // Memory replay with a forward-moving cache; moving backwards replays from the start.
  let memIndex = -1;
  let mem = new Uint8Array(initialDmem);
  const memoryAt = (index: number): Uint8Array => {
    if (index < memIndex) {
      memIndex = -1;
      mem = new Uint8Array(initialDmem);
    }
    for (let i = memIndex + 1; i <= index && i < n; i++) {
      const r = states[i]?.retired;
      if (!r || r.memWmask === 0) continue;
      if (r.memAddr < DATA_BASE || r.memAddr >= DATA_BASE + mem.length) continue; // MMIO or outside DMEM
      const off = r.memAddr - DATA_BASE;
      for (let b = 0; b < 4; b++) {
        if (r.memWmask >> b & 1) mem[off + b] = (r.memWdata >>> (8 * b)) & 0xff;
      }
    }
    memIndex = Math.min(index, n - 1);
    return mem;
  };

  const consoleAt = (index: number): string => {
    let out = "";
    for (let i = 0; i <= index && i < n; i++) {
      const c = states[i]?.console;
      if (c !== null && c !== undefined) out += String.fromCharCode(c);
    }
    return out;
  };

  const stats = (index: number): RunStats => {
    const i = Math.max(0, Math.min(index, n - 1));
    const cycles = states[i]?.cycle ?? 0;
    const ret = instret[i] ?? 0;
    return {
      cycles,
      instret: ret,
      cpi: ret > 0 ? cycles / ret : 0,
      stalls: stalls[i] ?? 0,
      loadUse: loadUse[i] ?? 0,
      flushes: flushes[i] ?? 0,
      forwards: forwards[i] ?? 0,
    };
  };

  return { states, stats, memoryAt, consoleAt };
}
