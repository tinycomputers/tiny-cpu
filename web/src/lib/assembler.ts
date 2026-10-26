// RV32I assembler for the TinyCPU web app. Two passes; the output is byte-identical to GNU as/ld for
// the supported subset (checked against riscv-none-elf-gcc in src/lib/__tests__/gnu-asm.test.ts).
//
// Supported: all RV32I + fence/ecall/ebreak, the Zicntr read CSRs (cycle, time, instret and the high
// halves), the GNU pseudo-instructions, labels (including numeric local labels 1:/1b/1f), .equ/.set,
// and the data directives .word .half .byte .ascii .asciz .string .space .zero .align .p2align .balign.
// Addresses: .text starts at 0x0000_0000 (IMEM), .data/.rodata/.bss at 0x0001_0000 (DMEM).
// Not supported (reported as errors): macros, relocations other than the pc-relative la/call/tail,
// misaligned data in instruction memory, and csrrs with a non-zero rs1 (the core would fault on it).
import { CSR_NAMES, INSNS, REG_NAMES, type InsnDef } from "./isa";

export const TEXT_BASE = 0x0000_0000;
export const DATA_BASE = 0x0001_0000;
export const IMEM_BYTES = 4096;
export const DMEM_BYTES = 4096;

const NOP = 0x0000_0013;
const FENCE = 0x0ff0_000f; // what GNU emits for a bare `fence`

export interface AsmError {
  line: number;
  message: string;
}

export interface AsmResult {
  ok: boolean;
  errors: AsmError[];
  /** Instruction memory, word-addressed from TEXT_BASE, zero-padded to IMEM_BYTES. */
  imem: Uint32Array;
  /** Data memory, byte-addressed from DATA_BASE, zero-padded to DMEM_BYTES. */
  dmem: Uint8Array;
  /** Label and .equ values. Labels in .data are absolute addresses. */
  symbols: Record<string, number>;
  /** pc of each instruction -> 1-based source line. */
  lineOf: Record<number, number>;
  textBytes: number;
  dataBytes: number;
}

// ------------------------------------------------------------------ registers and tables

const REG_BY_NAME = new Map<string, number>();
REG_NAMES.forEach((n, i) => REG_BY_NAME.set(n, i));
for (let i = 0; i < 32; i++) REG_BY_NAME.set(`x${i}`, i);
REG_BY_NAME.set("fp", 8);

const CSR_BY_NAME = new Map<string, number>();
for (const [k, v] of Object.entries(CSR_NAMES)) CSR_BY_NAME.set(v, Number(k));

const DEF = new Map<string, InsnDef>(INSNS.map((d) => [d.name, d]));
const LOADS = new Set(["lb", "lh", "lw", "lbu", "lhu"]);

export function regNumber(token: string): number | undefined {
  return REG_BY_NAME.get(token.trim().toLowerCase());
}

// ------------------------------------------------------------------ expressions

class ExprError extends Error {
  constructor(message: string, readonly unresolved = false) {
    super(message);
  }
}

type Resolver = (name: string) => number;

const TOKEN = /\s*(0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+[bf](?!\w)|\d+|'(?:\\.|[^'])'|[A-Za-z_.$][\w.$]*|<<|>>|[-+*/%&|^~()])/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m || !m[1]) throw new ExprError(`bad token in expression '${src.trim()}'`);
    out.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return out;
}

function charValue(tok: string): number {
  const body = tok.slice(1, -1);
  if (body.startsWith("\\")) {
    const esc: Record<string, number> = { n: 10, t: 9, r: 13, "0": 0, "\\": 92, "'": 39, '"': 34 };
    const c = esc[body[1] ?? ""];
    if (c === undefined) throw new ExprError(`unknown escape '${tok}'`);
    return c;
  }
  return body.charCodeAt(0);
}

function parseNumber(tok: string): number | undefined {
  if (/^0x/i.test(tok)) return parseInt(tok.slice(2), 16);
  if (/^0b/i.test(tok)) return parseInt(tok.slice(2), 2);
  if (/^0o/i.test(tok)) return parseInt(tok.slice(2), 8);
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  return undefined;
}

/** Evaluates a C-like integer expression. Throws ExprError; `unresolved` marks unknown symbols. */
export function evalExpr(src: string, resolve: Resolver): number {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  function primary(): number {
    const t = next();
    if (t === undefined) throw new ExprError(`expression '${src.trim()}' is incomplete`);
    if (t === "(") {
      const v = orExpr();
      if (next() !== ")") throw new ExprError(`missing ')' in '${src.trim()}'`);
      return v;
    }
    if (t === "-") return -unary();
    if (t === "+") return unary();
    if (t === "~") return ~unary();
    if (t.startsWith("'")) return charValue(t);
    const n = parseNumber(t);
    if (n !== undefined) return n;
    if (/^[A-Za-z_.$]/.test(t) || /^\d+[bf]$/.test(t)) return resolve(t);
    throw new ExprError(`unexpected '${t}' in '${src.trim()}'`);
  }
  function unary(): number {
    return primary();
  }
  function mulExpr(): number {
    let v = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = unary();
      if (op === "*") v *= r;
      else if (op === "/") {
        if (r === 0) throw new ExprError("division by zero");
        v = Math.trunc(v / r);
      } else v %= r;
    }
    return v;
  }
  function addExpr(): number {
    let v = mulExpr();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = mulExpr();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function shiftExpr(): number {
    let v = addExpr();
    while (peek() === "<<" || peek() === ">>") {
      const op = next();
      const r = addExpr();
      v = op === "<<" ? v * 2 ** r : Math.floor(v / 2 ** r);
    }
    return v;
  }
  function andExpr(): number {
    let v = shiftExpr();
    while (peek() === "&") {
      next();
      v = Number(BigInt.asIntN(64, BigInt(v) & BigInt(shiftExpr())));
    }
    return v;
  }
  function xorExpr(): number {
    let v = andExpr();
    while (peek() === "^") {
      next();
      v = Number(BigInt.asIntN(64, BigInt(v) ^ BigInt(andExpr())));
    }
    return v;
  }
  function orExpr(): number {
    let v = xorExpr();
    while (peek() === "|") {
      next();
      v = Number(BigInt.asIntN(64, BigInt(v) | BigInt(xorExpr())));
    }
    return v;
  }

  if (toks.length === 0) throw new ExprError("missing operand");
  const v = orExpr();
  if (i !== toks.length) throw new ExprError(`unexpected '${toks[i]}' in '${src.trim()}'`);
  return v;
}

/**
 * Padding inside .text, as GNU as emits it: a zero byte if the start is odd, then 4-byte nops while they
 * fit, then a 2-byte c.nop (01 00) when only a halfword is left. Anything else stays zero.
 */
function codeFill(start: number, pad: number): Uint8Array {
  const out = new Uint8Array(pad);
  let i = 0;
  let p = start;
  if (p % 2 === 1 && pad > 0) {
    i++;
    p++;
  }
  while (pad - i >= 4 && p % 4 === 0) {
    out.set([NOP & 0xff, (NOP >>> 8) & 0xff, (NOP >>> 16) & 0xff, NOP >>> 24], i);
    i += 4;
    p += 4;
  }
  if (pad - i >= 2 && p % 4 === 2) {
    out[i] = 0x01;
    out[i + 1] = 0x00;
    i += 2;
  }
  return out;
}

const sext12 = (v: number) => ((v & 0xfff) ^ 0x800) - 0x800;
const toU32 = (v: number) => v >>> 0;

// ------------------------------------------------------------------ lexing helpers

/** Splits a line into statements on ';' outside string and character literals. */
function splitStatements(line: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < line.length) cur += line[++i];
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === ";") {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

function stripComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
    else if (c === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

/** Splits on commas that are outside parentheses and string/char literals. */
function splitOperands(s: string): string[] {
  if (s.trim() === "") return [];
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < s.length) cur += s[++i];
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseStringLiteral(s: string): Uint8Array | undefined {
  const t = s.trim();
  if (t.length < 2 || t[0] !== '"' || t[t.length - 1] !== '"') return undefined;
  const bytes: number[] = [];
  const body = t.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    let c = body[i] as string;
    if (c === "\\") {
      const e = body[++i] ?? "";
      const esc: Record<string, number> = { n: 10, t: 9, r: 13, "0": 0, "\\": 92, '"': 34, "'": 39 };
      if (e === "x") {
        bytes.push(parseInt(body.slice(i + 1, i + 3), 16));
        i += 2;
        continue;
      }
      if (esc[e] === undefined) throw new ExprError(`unknown escape \\${e}`);
      bytes.push(esc[e] as number);
      continue;
    }
    bytes.push(c.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(bytes);
}

// ------------------------------------------------------------------ encoding

function fieldsWord(d: InsnDef, f: { rd?: number; rs1?: number; rs2?: number; imm?: number; csr?: number }): number {
  const rd = f.rd ?? 0;
  const rs1 = f.rs1 ?? 0;
  const rs2 = f.rs2 ?? 0;
  const imm = f.imm ?? 0;
  let w = d.match;
  switch (d.fmt) {
    case "R":
      w |= (rd << 7) | (rs1 << 15) | (rs2 << 20);
      break;
    case "I":
      w |= (rd << 7) | (rs1 << 15) | ((imm & 0xfff) << 20);
      break;
    case "SH":
      w |= (rd << 7) | (rs1 << 15) | ((imm & 0x1f) << 20);
      break;
    case "S":
      w |= ((imm & 0x1f) << 7) | (rs1 << 15) | (rs2 << 20) | (((imm >> 5) & 0x7f) << 25);
      break;
    case "B":
      w |=
        (((imm >> 11) & 1) << 7) |
        (((imm >> 1) & 0xf) << 8) |
        (rs1 << 15) |
        (rs2 << 20) |
        (((imm >> 5) & 0x3f) << 25) |
        (((imm >> 12) & 1) << 31);
      break;
    case "U":
      w |= (rd << 7) | (imm & 0xfffff000);
      break;
    case "J":
      w |=
        (rd << 7) |
        (((imm >> 12) & 0xff) << 12) |
        (((imm >> 11) & 1) << 20) |
        (((imm >> 1) & 0x3ff) << 21) |
        (((imm >> 20) & 1) << 31);
      break;
    case "CSR":
      w |= (rd << 7) | (rs1 << 15) | (((f.csr ?? 0) & 0xfff) << 20);
      break;
    default:
      break;
  }
  return toU32(w);
}

function rangeCheck(name: string, v: number, lo: number, hi: number, what = "immediate"): void {
  if (v < lo || v > hi) throw new ExprError(`${name}: ${what} ${v} out of range [${lo}, ${hi}]`);
}

interface Ctx {
  resolve: Resolver;
  pc: number;
}

function reg(token: string | undefined, mnem: string): number {
  const r = token === undefined ? undefined : regNumber(token);
  if (r === undefined) throw new ExprError(`${mnem}: '${token ?? ""}' is not a register`);
  return r;
}

function val(token: string | undefined, ctx: Ctx, mnem: string): number {
  if (token === undefined || token === "") throw new ExprError(`${mnem}: missing operand`);
  return evalExpr(token, ctx.resolve);
}

function memOperand(token: string | undefined, mnem: string, ctx: Ctx): { off: number; base: number } {
  const m = /^(.*)\(\s*([A-Za-z0-9_]+)\s*\)$/.exec((token ?? "").trim());
  if (!m) throw new ExprError(`${mnem}: expected offset(register), got '${token ?? ""}'`);
  const offText = (m[1] ?? "").trim();
  return { off: offText === "" ? 0 : val(offText, ctx, mnem), base: reg(m[2], mnem) };
}

function expect(ops: string[], n: number, mnem: string): void {
  if (ops.length !== n) throw new ExprError(`${mnem} expects ${n} operand${n === 1 ? "" : "s"}, got ${ops.length}`);
}

function li(rd: number, v: number, mnem: string): number[] {
  if (v < -(2 ** 31) || v > 2 ** 32 - 1) throw new ExprError(`${mnem}: ${v} does not fit in 32 bits`);
  const x = v | 0; // canonical signed 32-bit
  if (x >= -2048 && x <= 2047) return [fieldsWord(DEF.get("addi") as InsnDef, { rd, rs1: 0, imm: x })];
  const lo = sext12(x);
  const hi = ((x - lo) >>> 12) & 0xfffff;
  const out = [fieldsWord(DEF.get("lui") as InsnDef, { rd, imm: hi << 12 })];
  if (lo !== 0) out.push(fieldsWord(DEF.get("addi") as InsnDef, { rd, rs1: rd, imm: lo }));
  return out;
}

/** Number of words an instruction line occupies. `li` must be constant here (pass 1). */
function wordCount(mnem: string, ops: string[], constEval: (s: string) => number): number {
  if (mnem === "li") {
    const x = constEval(ops[1] ?? "") | 0;
    if (x >= -2048 && x <= 2047) return 1;
    return sext12(x) !== 0 ? 2 : 1;
  }
  if (mnem === "la" || mnem === "call" || mnem === "tail") return 2;
  return 1;
}

/** Encodes one instruction (or pseudo-instruction) at ctx.pc. */
function encode(mnem: string, ops: string[], ctx: Ctx): number[] {
  const d = DEF.get(mnem);
  const w = (name: string, f: Parameters<typeof fieldsWord>[1]) => fieldsWord(DEF.get(name) as InsnDef, f);
  // Addresses wrap modulo 2^32, so a target printed as 0xffffffd4 from pc 0 is the offset -44.
  const pcRel = (target: number) => (target - ctx.pc) | 0;

  // ---- pseudo-instructions (GNU spellings and expansions)
  switch (mnem) {
    case "nop":
      expect(ops, 0, mnem);
      return [w("addi", { rd: 0, rs1: 0, imm: 0 })];
    case "mv":
      expect(ops, 2, mnem);
      return [w("addi", { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), imm: 0 })];
    case "not":
      expect(ops, 2, mnem);
      return [w("xori", { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), imm: -1 })];
    case "neg":
      expect(ops, 2, mnem);
      return [w("sub", { rd: reg(ops[0], mnem), rs1: 0, rs2: reg(ops[1], mnem) })];
    case "seqz":
      expect(ops, 2, mnem);
      return [w("sltiu", { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), imm: 1 })];
    case "snez":
      expect(ops, 2, mnem);
      return [w("sltu", { rd: reg(ops[0], mnem), rs1: 0, rs2: reg(ops[1], mnem) })];
    case "sltz":
      expect(ops, 2, mnem);
      return [w("slt", { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), rs2: 0 })];
    case "sgtz":
      expect(ops, 2, mnem);
      return [w("slt", { rd: reg(ops[0], mnem), rs1: 0, rs2: reg(ops[1], mnem) })];
    case "beqz":
    case "bnez":
    case "bltz":
    case "bgez": {
      expect(ops, 2, mnem);
      const rs = reg(ops[0], mnem);
      const off = pcRel(val(ops[1], ctx, mnem));
      const map: Record<string, [string, number, number]> = {
        beqz: ["beq", rs, 0],
        bnez: ["bne", rs, 0],
        bltz: ["blt", rs, 0],
        bgez: ["bge", rs, 0],
      };
      const [name, a, b] = map[mnem] as [string, number, number];
      return [branch(name, a, b, off)];
    }
    case "blez":
    case "bgtz": {
      expect(ops, 2, mnem);
      const rs = reg(ops[0], mnem);
      const off = pcRel(val(ops[1], ctx, mnem));
      return mnem === "blez" ? [branch("bge", 0, rs, off)] : [branch("blt", 0, rs, off)];
    }
    case "bgt":
    case "ble":
    case "bgtu":
    case "bleu": {
      expect(ops, 3, mnem);
      const a = reg(ops[0], mnem);
      const b = reg(ops[1], mnem);
      const off = pcRel(val(ops[2], ctx, mnem));
      const map: Record<string, string> = { bgt: "blt", ble: "bge", bgtu: "bltu", bleu: "bgeu" };
      return [branch(map[mnem] as string, b, a, off)];
    }
    case "j":
      expect(ops, 1, mnem);
      return [w("jal", { rd: 0, imm: pcRel(val(ops[0], ctx, mnem)) })];
    case "jr":
      expect(ops, 1, mnem);
      return [w("jalr", { rd: 0, rs1: reg(ops[0], mnem), imm: 0 })];
    case "ret":
      expect(ops, 0, mnem);
      return [w("jalr", { rd: 0, rs1: 1, imm: 0 })];
    case "li": {
      expect(ops, 2, mnem);
      return li(reg(ops[0], mnem), val(ops[1], ctx, mnem), mnem);
    }
    case "la": {
      expect(ops, 2, mnem);
      const rd = reg(ops[0], mnem);
      const off = pcRel(val(ops[1], ctx, mnem));
      const hi = ((off + 0x800) >> 12) & 0xfffff;
      const lo = off - (hi << 12);
      return [w("auipc", { rd, imm: hi << 12 }), w("addi", { rd, rs1: rd, imm: lo })];
    }
    case "call":
    case "tail": {
      expect(ops, 1, mnem);
      const off = pcRel(val(ops[0], ctx, mnem));
      const hi = ((off + 0x800) >> 12) & 0xfffff;
      const lo = off - (hi << 12);
      const link = mnem === "call" ? 1 : 6; // ra for call, t1 for tail
      return [w("auipc", { rd: link, imm: hi << 12 }), w("jalr", { rd: mnem === "call" ? 1 : 0, rs1: link, imm: lo })];
    }
    case "csrr": {
      expect(ops, 2, mnem);
      return [csrrs(reg(ops[0], mnem), csrOperand(ops[1] ?? "", mnem), 0)];
    }
    case "rdcycle":
    case "rdtime":
    case "rdinstret":
    case "rdcycleh":
    case "rdtimeh":
    case "rdinstreth": {
      expect(ops, 1, mnem);
      return [csrrs(reg(ops[0], mnem), CSR_BY_NAME.get(mnem.slice(2)) as number, 0)];
    }
    default:
      break;
  }

  if (!d) throw new ExprError(`unknown instruction '${mnem}'`);

  switch (d.fmt) {
    case "R":
      expect(ops, 3, mnem);
      return [w(mnem, { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), rs2: reg(ops[2], mnem) })];
    case "SH": {
      expect(ops, 3, mnem);
      const sh = val(ops[2], ctx, mnem);
      rangeCheck(mnem, sh, 0, 31, "shift amount");
      return [w(mnem, { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), imm: sh })];
    }
    case "I": {
      if (mnem === "jalr") {
        if (ops.length === 1) return [w("jalr", { rd: 1, rs1: reg(ops[0], mnem), imm: 0 })];
        if (ops.length === 2) {
          const m = memOperand(ops[1], mnem, ctx);
          rangeCheck(mnem, m.off, -2048, 2047, "offset");
          return [w("jalr", { rd: reg(ops[0], mnem), rs1: m.base, imm: m.off })];
        }
        expect(ops, 3, mnem);
        const imm = val(ops[2], ctx, mnem);
        rangeCheck(mnem, imm, -2048, 2047, "offset");
        return [w("jalr", { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), imm })];
      }
      if (LOADS.has(mnem)) {
        expect(ops, 2, mnem);
        const m = memOperand(ops[1], mnem, ctx);
        rangeCheck(mnem, m.off, -2048, 2047, "offset");
        return [w(mnem, { rd: reg(ops[0], mnem), rs1: m.base, imm: m.off })];
      }
      expect(ops, 3, mnem);
      const imm = val(ops[2], ctx, mnem);
      rangeCheck(mnem, imm, -2048, 2047, "immediate");
      return [w(mnem, { rd: reg(ops[0], mnem), rs1: reg(ops[1], mnem), imm })];
    }
    case "S": {
      expect(ops, 2, mnem);
      const m = memOperand(ops[1], mnem, ctx);
      rangeCheck(mnem, m.off, -2048, 2047, "offset");
      return [w(mnem, { rs2: reg(ops[0], mnem), rs1: m.base, imm: m.off })];
    }
    case "B": {
      expect(ops, 3, mnem);
      return [branch(mnem, reg(ops[0], mnem), reg(ops[1], mnem), pcRel(val(ops[2], ctx, mnem)))];
    }
    case "U": {
      expect(ops, 2, mnem);
      const imm = val(ops[1], ctx, mnem);
      rangeCheck(mnem, imm, -524288, 0xfffff, "upper immediate");
      return [w(mnem, { rd: reg(ops[0], mnem), imm: (imm & 0xfffff) << 12 })];
    }
    case "J": {
      if (ops.length === 1) return [w("jal", { rd: 1, imm: pcRel(val(ops[0], ctx, mnem)) })];
      expect(ops, 2, mnem);
      return [w("jal", { rd: reg(ops[0], mnem), imm: pcRel(val(ops[1], ctx, mnem)) })];
    }
    case "FENCE":
      return [FENCE];
    case "SYS":
      expect(ops, 0, mnem);
      return [d.match];
    case "CSR": {
      expect(ops, 3, mnem);
      const rs1 = reg(ops[2], mnem);
      if (rs1 !== 0) throw new ExprError(`${mnem}: only read-only counter reads (rs1 = zero) are supported`);
      return [csrrs(reg(ops[0], mnem), csrOperand(ops[1] ?? "", mnem), rs1)];
    }
    default:
      throw new ExprError(`unhandled format for '${mnem}'`);
  }

  function branch(name: string, rs1: number, rs2: number, off: number): number {
    rangeCheck(name, off, -4096, 4094, "branch offset");
    if (off & 1) throw new ExprError(`${name}: branch offset ${off} is odd`);
    return fieldsWord(DEF.get(name) as InsnDef, { rs1, rs2, imm: off });
  }
  function csrrs(rd: number, csr: number, rs1: number): number {
    return fieldsWord(DEF.get("csrrs") as InsnDef, { rd, rs1, csr });
  }
  function csrOperand(token: string, mnem: string): number {
    const name = token.trim().toLowerCase();
    if (CSR_BY_NAME.has(name)) return CSR_BY_NAME.get(name) as number;
    const n = parseNumber(name);
    if (n !== undefined && CSR_NAMES[n] !== undefined) return n;
    throw new ExprError(`${mnem}: '${token}' is not a supported counter CSR (cycle, time, instret, *h)`);
  }
}

// ------------------------------------------------------------------ the assembler

type Section = "text" | "data";

type Item =
  | { kind: "insn"; line: number; sec: "text"; off: number; mnem: string; ops: string[]; words: number; lseq: number }
  | { kind: "values"; line: number; sec: Section; off: number; unit: 1 | 2 | 4; exprs: string[]; lseq: number }
  | { kind: "bytes"; line: number; sec: Section; off: number; data: Uint8Array }
  | { kind: "fill"; line: number; sec: Section; off: number; data: Uint8Array };

export function assemble(source: string): AsmResult {
  const errors: AsmError[] = [];
  const items: Item[] = [];
  const labels = new Map<string, { sec: Section; off: number }>();
  const equs = new Map<string, number>();
  const localDefs = new Map<string, { id: number; sec: Section; off: number }[]>();
  const offs: Record<Section, number> = { text: 0, data: 0 };
  let sec: Section = "text";
  let lcount = 0;

  const constEval = (expr: string): number =>
    evalExpr(expr, (name) => {
      const v = equs.get(name);
      if (v === undefined) throw new ExprError(`'${name}' must be a constant defined before use here`, true);
      return v;
    });

  const addr = (s: Section, off: number) => (s === "text" ? TEXT_BASE + off : DATA_BASE + off);

  // ---------------- pass 1: sections, labels, sizes
  const lines = source.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    for (const part of splitStatements(stripComment(raw))) statement(part, idx + 1);
  });

  function statement(part: string, lineNo: number): void {
    try {
      let text = part.trim();
      // leading labels (name: or 1:)
      for (;;) {
        const m = /^([A-Za-z_.$][\w.$]*|\d+)\s*:/.exec(text);
        if (!m) break;
        const name = m[1] as string;
        if (/^\d+$/.test(name)) {
          lcount++;
          const list = localDefs.get(name) ?? [];
          list.push({ id: lcount, sec, off: offs[sec] });
          localDefs.set(name, list);
        } else {
          if (labels.has(name) || equs.has(name)) throw new ExprError(`symbol '${name}' is already defined`);
          labels.set(name, { sec, off: offs[sec] });
        }
        text = text.slice(m[0].length).trim();
      }
      if (text === "") return;

      const head = /^(\S+)\s*(.*)$/.exec(text) as RegExpExecArray;
      const word = (head[1] as string).toLowerCase();
      const rest = head[2] as string;

      if (word.startsWith(".")) {
        directive(word, rest, lineNo);
        return;
      }

      const ops = splitOperands(rest);
      const words = wordCount(word, ops, constEval);
      if (!DEF.has(word) && !PSEUDO.has(word)) throw new ExprError(`unknown instruction '${word}'`);
      if (sec !== "text") throw new ExprError(`instruction '${word}' outside .text`);
      if (offs.text % 4 !== 0) throw new ExprError("instruction is not word-aligned");
      items.push({ kind: "insn", line: lineNo, sec: "text", off: offs.text, mnem: word, ops, words, lseq: lcount });
      offs.text += 4 * words;
    } catch (e) {
      errors.push({ line: lineNo, message: e instanceof Error ? e.message : String(e) });
    }
  }

  function directive(word: string, rest: string, lineNo: number): void {
    const args = splitOperands(rest);
    switch (word) {
      case ".text":
        sec = "text";
        return;
      case ".data":
      case ".rodata":
      case ".bss":
        sec = "data";
        return;
      case ".section": {
        const name = (args[0] ?? "").trim();
        sec = name.startsWith(".text") ? "text" : "data";
        return;
      }
      case ".globl":
      case ".global":
      case ".local":
      case ".weak":
      case ".type":
      case ".size":
      case ".file":
      case ".ident":
      case ".option":
      case ".attribute":
        return;
      case ".equ":
      case ".set": {
        if (args.length !== 2) throw new ExprError(`${word} expects name, value`);
        const name = (args[0] as string).trim();
        if (labels.has(name) || equs.has(name)) throw new ExprError(`symbol '${name}' is already defined`);
        equs.set(name, constEval(args[1] as string));
        return;
      }
      case ".word":
      case ".long":
      case ".4byte":
      case ".half":
      case ".short":
      case ".2byte":
      case ".byte": {
        const unit = word === ".byte" ? 1 : word === ".half" || word === ".short" || word === ".2byte" ? 2 : 4;
        if (args.length === 0) throw new ExprError(`${word} needs at least one value`);
        items.push({ kind: "values", line: lineNo, sec, off: offs[sec], unit, exprs: args, lseq: lcount });
        offs[sec] += unit * args.length;
        return;
      }
      case ".ascii":
      case ".asciz":
      case ".string": {
        let total = new Uint8Array(0);
        for (const a of args) {
          const b = parseStringLiteral(a);
          if (!b) throw new ExprError(`${word} expects string literals`);
          const extra = word === ".ascii" ? 0 : 1;
          const joined = new Uint8Array(total.length + b.length + extra);
          joined.set(total);
          joined.set(b, total.length);
          total = joined;
        }
        items.push({ kind: "bytes", line: lineNo, sec, off: offs[sec], data: total });
        offs[sec] += total.length;
        return;
      }
      case ".space":
      case ".zero":
      case ".skip": {
        const n = constEval(args[0] ?? "");
        const fill = args[1] !== undefined ? constEval(args[1]) & 0xff : 0;
        if (n < 0) throw new ExprError(`${word}: negative size`);
        items.push({ kind: "fill", line: lineNo, sec, off: offs[sec], data: new Uint8Array(n).fill(fill) });
        offs[sec] += n;
        return;
      }
      case ".align":
      case ".p2align":
      case ".balign": {
        const v = constEval(args[0] ?? "");
        const align = word === ".balign" ? v : 2 ** v;
        if (align <= 0 || (align & (align - 1)) !== 0) throw new ExprError(`${word}: alignment must be a power of two`);
        const pad = (align - (offs[sec] % align)) % align;
        if (pad === 0) return;
        const data = sec === "text" ? codeFill(offs[sec], pad) : new Uint8Array(pad);
        items.push({ kind: "fill", line: lineNo, sec, off: offs[sec], data });
        offs[sec] += pad;
        return;
      }
      default:
        throw new ExprError(`unknown directive '${word}'`);
    }
  }

  // ---------------- pass 2: encode and place
  const imem = new Uint8Array(IMEM_BYTES);
  const dmem = new Uint8Array(DMEM_BYTES);
  const lineOf: Record<number, number> = {};

  const resolverFor = (lseq: number): Resolver => (name) => {
    const local = /^(\d+)([bf])$/.exec(name);
    if (local) {
      const defs = localDefs.get(local[1] as string) ?? [];
      const pick =
        local[2] === "b"
          ? [...defs].reverse().find((d) => d.id <= lseq)
          : defs.find((d) => d.id > lseq);
      if (!pick) throw new ExprError(`no ${local[1]}${local[2] === "b" ? " before" : " after"} this line`);
      return addr(pick.sec, pick.off);
    }
    const eq = equs.get(name);
    if (eq !== undefined) return eq;
    const l = labels.get(name);
    if (l) return addr(l.sec, l.off);
    throw new ExprError(`undefined symbol '${name}'`);
  };

  for (const it of items) {
    try {
      if (it.kind === "fill" || it.kind === "bytes") {
        (it.sec === "text" ? imem : dmem).set(it.data, it.off);
        continue;
      }
      if (it.kind === "values") {
        const bytes = new Uint8Array(it.unit * it.exprs.length);
        it.exprs.forEach((e, i) => {
          const v = evalExpr(e, resolverFor(it.lseq));
          const lo = it.unit === 1 ? -128 : it.unit === 2 ? -32768 : -(2 ** 31);
          const hi = it.unit === 1 ? 255 : it.unit === 2 ? 65535 : 2 ** 32 - 1;
          if (v < lo || v > hi) throw new ExprError(`value ${v} does not fit in ${it.unit} byte(s)`);
          for (let b = 0; b < it.unit; b++) bytes[i * it.unit + b] = (v >>> (8 * b)) & 0xff;
        });
        (it.sec === "text" ? imem : dmem).set(bytes, it.off);
        continue;
      }
      const pc = TEXT_BASE + it.off;
      const words = encode(it.mnem, it.ops, { resolve: resolverFor(it.lseq), pc });
      if (words.length !== it.words) throw new ExprError(`internal: '${it.mnem}' size changed between passes`);
      words.forEach((wd, i) => {
        const p = it.off + 4 * i;
        imem.set([wd & 0xff, (wd >>> 8) & 0xff, (wd >>> 16) & 0xff, wd >>> 24], p);
        lineOf[TEXT_BASE + p] = it.line;
      });
    } catch (e) {
      errors.push({ line: it.line, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Sizes are checked after encoding so a program that is too big reports the real overflow.
  if (offs.text > IMEM_BYTES) errors.push({ line: 0, message: `program is ${offs.text} bytes; IMEM holds ${IMEM_BYTES}` });
  if (offs.data > DMEM_BYTES) errors.push({ line: 0, message: `data is ${offs.data} bytes; DMEM holds ${DMEM_BYTES}` });

  const words = new Uint32Array(IMEM_BYTES / 4);
  for (let i = 0; i < words.length; i++) {
    words[i] = (imem[4 * i] as number) | ((imem[4 * i + 1] as number) << 8) | ((imem[4 * i + 2] as number) << 16) | ((imem[4 * i + 3] as number) << 24) >>> 0;
  }

  const symbols: Record<string, number> = {};
  for (const [name, l] of labels) symbols[name] = addr(l.sec, l.off);
  for (const [name, v] of equs) symbols[name] = v;

  errors.sort((a, b) => a.line - b.line);
  return {
    ok: errors.length === 0,
    errors,
    imem: words,
    dmem,
    symbols,
    lineOf,
    textBytes: offs.text,
    dataBytes: offs.data,
  };
}

const PSEUDO = new Set([
  "nop", "mv", "not", "neg", "seqz", "snez", "sltz", "sgtz", "beqz", "bnez", "blez", "bgez", "bltz", "bgtz",
  "bgt", "ble", "bgtu", "bleu", "j", "jr", "ret", "li", "la", "call", "tail", "csrr",
  "rdcycle", "rdtime", "rdinstret", "rdcycleh", "rdtimeh", "rdinstreth",
]);

