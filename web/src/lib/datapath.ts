// What the single-cycle datapath does for one instruction, read from a SINGLE run: operand values come from
// the register file before the instruction retired, and results from its retire record. Pure functions; the
// datapath view draws whatever this returns.
import { decodeWord, disassemble } from "./disassembler";
import type { CycleState } from "./state-schema";

export interface DatapathInfo {
  order: number;
  pc: number;
  insn: number;
  text: string;
  name: string;
  fmt: string;
  rd: number;
  rs1: number;
  rs2: number;
  imm: number;
  rs1Value: number;
  rs2Value: number;
  /** operand B is the immediate (I, S, U, J formats and the immediate ALU forms) */
  usesImm: boolean;
  usesRs1: boolean;
  usesRs2: boolean;
  isBranch: boolean;
  isJump: boolean;
  isLoad: boolean;
  isStore: boolean;
  taken: boolean;
  nextPc: number;
  /** effective address for loads and stores: rs1 + imm */
  memAddr: number | null;
  memReadValue: number | null;
  memWriteValue: number | null;
  /** value written to rd (0 when rd is not written) */
  writeValue: number;
  writesRd: boolean;
}

const ZERO = new Array<number>(32).fill(0);
const USES_IMM = new Set(["I", "S", "U", "J", "SH"]);

/** The state index whose retire record has this order, or -1. */
export function indexOfOrder(states: readonly CycleState[], order: number): number {
  return states.findIndex((s) => s.retired?.order === order);
}

/** Order of the most recent retire at or before `index`, or undefined when nothing has retired yet. */
export function lastRetireOrder(states: readonly CycleState[], index: number): number | undefined {
  for (let i = Math.min(index, states.length - 1); i >= 0; i--) {
    const r = states[i]?.retired;
    if (r) return r.order;
  }
  return undefined;
}

/**
 * The datapath of the instruction with retire order `order`, from a SINGLE run. Returns null when no such
 * retire exists in the run.
 */
export function datapathFor(states: readonly CycleState[], order: number): DatapathInfo | null {
  const i = indexOfOrder(states, order);
  if (i < 0) return null;
  const r = states[i]?.retired;
  if (!r) return null;
  const before = i > 0 ? (states[i - 1]?.regs ?? ZERO) : ZERO;
  const d = decodeWord(r.insn);
  const fmt = d?.fmt ?? "";
  const name = d?.name ?? "";
  const rs1 = d?.rs1 ?? 0;
  const rs2 = d?.rs2 ?? 0;
  const imm = d?.imm ?? 0;
  const rs1Value = before[rs1] ?? 0;
  const rs2Value = before[rs2] ?? 0;
  const isLoad = fmt === "I" && /^l[bhw]u?$/.test(name);
  const isStore = fmt === "S";
  const isBranch = fmt === "B";
  const isJump = name === "jal" || name === "jalr";
  const taken = isBranch || isJump ? r.pcWdata !== ((r.pc + 4) >>> 0) : false;
  const memAddr = isLoad || isStore ? (rs1Value + imm) >>> 0 : null;
  return {
    order,
    pc: r.pc,
    insn: r.insn,
    text: disassemble(r.insn, r.pc),
    name,
    fmt,
    rd: d?.rd ?? 0,
    rs1,
    rs2,
    imm,
    rs1Value,
    rs2Value,
    usesImm: USES_IMM.has(fmt),
    usesRs1: ["R", "I", "SH", "S", "B"].includes(fmt),
    usesRs2: fmt === "R" || fmt === "S" || fmt === "B",
    isBranch,
    isJump,
    isLoad,
    isStore,
    taken,
    nextPc: r.pcWdata,
    memAddr,
    memReadValue: isLoad ? r.memRdata : null,
    memWriteValue: isStore ? r.memWdata : null,
    writeValue: r.rdAddr ? r.rdWdata : 0,
    writesRd: r.rdAddr !== 0,
  };
}
