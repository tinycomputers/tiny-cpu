// TypeScript mirror of docs/STATE_SCHEMA.md - the JavaScript contract of wasm/harness.cpp.
// Keep the two in sync: a field added to one must be added to the other.

export type CoreName = "SINGLE" | "PIPE";
export type StageName = "IF" | "ID" | "EX" | "MEM" | "WB";
export const STAGE_NAMES: readonly StageName[] = ["IF", "ID", "EX", "MEM", "WB"];

export interface Stage {
  name: StageName;
  valid: boolean;
  pc: number;
  insn: number;
}

export interface Hazard {
  stall: boolean;
  loadUse: boolean;
  flushIFID: boolean;
  flushIDEX: boolean;
  fwdA: 0 | 1 | 2;
  fwdB: 0 | 1 | 2;
}

export interface Retire {
  order: number;
  pc: number;
  insn: number;
  rdAddr: number;
  rdWdata: number;
  pcWdata: number;
  memAddr: number;
  memRmask: number;
  memWmask: number;
  memRdata: number;
  memWdata: number;
  misaligned: boolean;
  halt: boolean;
  cycleDep: boolean;
}

export interface CycleState {
  cycle: number;
  halted: boolean;
  fault: boolean;
  stages: Stage[];
  hazard: Hazard;
  regs: number[];
  retired: Retire | null;
  console: number | null;
  tohost: number | null;
  counters: { cycle: number; instret: number };
}

export interface RunSummary {
  cycles: number;
  instret: number;
  halted: boolean;
  fault: boolean;
  tohost: number | null;
  console: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const isU32 = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0xffff_ffff;
const isBool = (x: unknown) => typeof x === "boolean";

function isRetire(x: unknown): x is Retire {
  if (!isObj(x)) return false;
  return (
    isU32(x.order) && isU32(x.pc) && isU32(x.insn) && isU32(x.rdAddr) && isU32(x.rdWdata) &&
    isU32(x.pcWdata) && isU32(x.memAddr) && isU32(x.memRmask) && isU32(x.memWmask) &&
    isU32(x.memRdata) && isU32(x.memWdata) && isBool(x.misaligned) && isBool(x.halt) && isBool(x.cycleDep)
  );
}

/** Structural check for a CycleState coming across the WASM boundary. */
export function isCycleState(x: unknown): x is CycleState {
  if (!isObj(x)) return false;
  if (!isU32(x.cycle) || !isBool(x.halted) || !isBool(x.fault)) return false;
  if (!Array.isArray(x.stages) || x.stages.length !== 5) return false;
  const stagesOk = x.stages.every(
    (s, i) => isObj(s) && s.name === STAGE_NAMES[i] && isBool(s.valid) && isU32(s.pc) && isU32(s.insn),
  );
  if (!stagesOk || !isObj(x.hazard)) return false;
  const h = x.hazard;
  const hazardOk = isBool(h.stall) && isBool(h.loadUse) && isBool(h.flushIFID) && isBool(h.flushIDEX) &&
    [0, 1, 2].includes(h.fwdA as number) && [0, 1, 2].includes(h.fwdB as number);
  if (!hazardOk) return false;
  if (!Array.isArray(x.regs) || x.regs.length !== 32 || !x.regs.every(isU32)) return false;
  if (x.retired !== null && !isRetire(x.retired)) return false;
  if (x.console !== null && !(isU32(x.console) && (x.console as number) < 256)) return false;
  if (x.tohost !== null && !isU32(x.tohost)) return false;
  return isObj(x.counters) && isU32(x.counters.cycle) && isU32(x.counters.instret);
}
