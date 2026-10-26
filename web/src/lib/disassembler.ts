// RV32I disassembler for the TinyCPU web app. Output follows sim/golden/decode.py's disasm() so the two
// can be compared, and it re-assembles to the same word with src/lib/assembler.ts (round-trip tested).
import { CSR_NAMES, INSNS, REG_NAMES } from "./isa";

const LOADS = new Set(["lb", "lh", "lw", "lbu", "lhu"]);

const sext = (v: number, bits: number) => (v << (32 - bits)) >> (32 - bits);

export interface Decoded {
  name: string;
  fmt: string;
  rd: number;
  rs1: number;
  rs2: number;
  imm: number;
  csr: number;
}

/** Decodes a word into its instruction name and fields, or undefined if it is not a supported instruction. */
export function decodeWord(w: number): Decoded | undefined {
  const u = w >>> 0;
  const def = INSNS.find((d) => (u & d.mask) >>> 0 === d.match);
  if (!def) return undefined;
  const rd = (u >>> 7) & 31;
  const rs1 = (u >>> 15) & 31;
  const rs2 = (u >>> 20) & 31;
  const immI = sext(u >>> 20, 12);
  const immS = sext(((u >>> 25) << 5) | ((u >>> 7) & 31), 12);
  const immB = sext(
    ((u >>> 31) << 12) | (((u >>> 7) & 1) << 11) | (((u >>> 25) & 0x3f) << 5) | (((u >>> 8) & 0xf) << 1),
    13,
  );
  const immJ = sext(
    ((u >>> 31) << 20) | (((u >>> 12) & 0xff) << 12) | (((u >>> 20) & 1) << 11) | (((u >>> 21) & 0x3ff) << 1),
    21,
  );
  const base = { name: def.name, fmt: def.fmt, rd, rs1, rs2, imm: 0, csr: 0 };
  switch (def.fmt) {
    case "R":
      return { ...base, rd, rs1, rs2 };
    case "I":
      return { ...base, rs2: 0, imm: immI };
    case "SH":
      return { ...base, rs2: 0, imm: rs2 };
    case "S":
      return { ...base, rd: 0, imm: immS };
    case "B":
      return { ...base, rd: 0, imm: immB };
    case "U":
      return { ...base, rs1: 0, rs2: 0, imm: (u & 0xfffff000) | 0 };
    case "J":
      return { ...base, rs1: 0, rs2: 0, imm: immJ };
    case "CSR":
      return { ...base, rs2: 0, csr: u >>> 20 };
    default:
      return { ...base, rd: 0, rs1: 0, rs2: 0 };
  }
}

/**
 * ABI-name disassembly. With `pc`, branch and jump targets are shown as absolute addresses (as
 * the assembler accepts them back); without it, as pc-relative offsets.
 */
export function disassemble(w: number, pc?: number): string {
  const x = decodeWord(w);
  if (!x) return `.word 0x${(w >>> 0).toString(16).padStart(8, "0")}`;
  const r = REG_NAMES;
  const n = x.name;
  const target = () => (pc !== undefined ? `0x${((pc + x.imm) >>> 0).toString(16)}` : `${x.imm >= 0 ? "+" : ""}${x.imm}`);
  switch (x.fmt) {
    case "R":
      return `${n} ${r[x.rd]}, ${r[x.rs1]}, ${r[x.rs2]}`;
    case "SH":
      return `${n} ${r[x.rd]}, ${r[x.rs1]}, ${x.imm}`;
    case "I":
      if (LOADS.has(n) || n === "jalr") return `${n} ${r[x.rd]}, ${x.imm}(${r[x.rs1]})`;
      return `${n} ${r[x.rd]}, ${r[x.rs1]}, ${x.imm}`;
    case "S":
      return `${n} ${r[x.rs2]}, ${x.imm}(${r[x.rs1]})`;
    case "B":
      return `${n} ${r[x.rs1]}, ${r[x.rs2]}, ${target()}`;
    case "U":
      return `${n} ${r[x.rd]}, 0x${((x.imm >>> 0) >>> 12).toString(16)}`;
    case "J":
      return `${n} ${r[x.rd]}, ${target()}`;
    case "CSR":
      return `${n} ${r[x.rd]}, ${CSR_NAMES[x.csr] ?? `0x${x.csr.toString(16)}`}, ${r[x.rs1]}`;
    default:
      return n;
  }
}
