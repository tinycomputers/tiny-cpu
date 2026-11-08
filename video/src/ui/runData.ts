// Turns the exported JSON (scripts/gen-data.ts) into the shapes the app's own components take.
import raw from "../data/run-data.json";
import type { CycleState } from "@web/lib/state-schema";
import type { AsmResult } from "@web/lib/assembler";
import type { DatapathInfo } from "@web/lib/datapath";
import type { RunModel, RunStats } from "@web/lib/run-model";

export interface Win {
  index: number;
  state: CycleState;
  stats: RunStats;
  console: string;
  mem: Uint8Array;
}

export interface RunBundle {
  total: number;
  source: string;
  asm: AsmResult;
  model: RunModel;
  windows: Win[];
  /** The exported window at `index`, or the nearest earlier one. */
  at(index: number): Win;
}

interface RawWin {
  index: number;
  state: CycleState;
  stats: RunStats;
  console: string;
  mem: string;
}

const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

function bundle(total: number, source: string, imem: number[], lineOf: Record<string, number>, windows: RawWin[], memLen: number): RunBundle {
  const wins: Win[] = windows.map((w) => ({ ...w, mem: unhex(w.mem) }));
  const byIndex = new Map(wins.map((w) => [w.index, w]));
  const states: CycleState[] = new Array(total);
  for (const w of wins) states[w.index] = w.state;
  const sorted = [...wins].sort((a, b) => a.index - b.index);
  const at = (index: number): Win => {
    const hit = byIndex.get(index);
    if (hit) return hit;
    let best = sorted[0] as Win;
    for (const w of sorted) {
      if (w.index <= index) best = w;
      else break;
    }
    return best;
  };
  const asm = {
    ok: true,
    errors: [],
    imem: Uint32Array.from(imem),
    dmem: new Uint8Array(memLen),
    symbols: {},
    lineOf: Object.fromEntries(Object.entries(lineOf).map(([k, v]) => [Number(k), v])),
    textBytes: imem.length * 4,
    dataBytes: 0,
  } as AsmResult;
  const model: RunModel = {
    states,
    stats: (i) => at(i).stats,
    memoryAt: (i) => at(i).mem,
    consoleAt: (i) => at(i).console,
  };
  return { total, source, asm, model, windows: sorted, at };
}

const hero = raw.fib as unknown as {
  total: number;
  source: string;
  imem: number[];
  lineOf: Record<string, number>;
  windows: RawWin[];
  memLen: number;
};
export const HERO: RunBundle = bundle(hero.total, hero.source, hero.imem, hero.lineOf, hero.windows, hero.memLen);

const nf = raw.noFwd as unknown as { total: number; windows: RawWin[] };
export const NOFWD: RunBundle = bundle(nf.total, hero.source, hero.imem, hero.lineOf, nf.windows, hero.memLen);

export const EVENTS = raw.events as { stall: number; forward: number; flush: number; firstSwap: number };
export const DATAPATH = raw.datapath as unknown as Record<"add" | "load" | "branch", DatapathInfo>;
export const HELLO_SOURCE = (raw as unknown as { helloSource: string }).helloSource;
export const FMAX_MHZ = raw.fmaxMhz as number;

export interface HazardRow {
  name: string;
  cycles: number;
  stalls: number | null;
  flushes: number | null;
}
export interface HazardData {
  id: string;
  title: string;
  why: string;
  expect: string;
  source: string;
  rows: HazardRow[];
  timelineFwd: (number | null)[][];
  timelineNoFwd: (number | null)[][];
}
export const HAZARD = raw.hazard as unknown as HazardData[];

export interface ProgramRow {
  id: string;
  title: string;
  description: string;
  instructions: number;
  singleCycles: number;
  pipeCycles: number;
  noFwdCycles: number;
  pipeCpi: number;
  stalls: number;
  flushes: number;
  pass: boolean;
  timeUs: number;
  output: string;
  heat: { words: number; reads: number[]; writes: number[] };
}
export const PROGRAMS = raw.programs as unknown as ProgramRow[];

export const PRESET_LIST = [
  { id: "hello", title: "Hello" },
  { id: "fib", title: "Fibonacci" },
  { id: "sort", title: "Bubble sort" },
  { id: "memcpy", title: "memcpy" },
  { id: "primes", title: "Primes" },
];
