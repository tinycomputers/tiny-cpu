import { describe, expect, it } from "vitest";
import { assemble, evalExpr, DATA_BASE } from "../assembler";

const words = (src: string) => {
  const r = assemble(src);
  expect(r.errors).toEqual([]);
  return Array.from(r.imem.subarray(0, r.textBytes / 4));
};

describe("assembler: encodings", () => {
  it("encodes the basic forms with known words", () => {
    expect(words("addi ra, zero, 5")).toEqual([0x00500093]);
    expect(words("add a0, a1, a2")).toEqual([0x00c58533]);
    expect(words("ecall")).toEqual([0x00000073]);
    expect(words("ebreak")).toEqual([0x00100073]);
    expect(words("fence")).toEqual([0x0ff0000f]);
    expect(words("nop")).toEqual([0x00000013]);
    expect(words("ret")).toEqual([0x00008067]);
  });

  it("accepts ABI, x-number and fp register names", () => {
    expect(words("mv x10, fp")).toEqual(words("mv a0, s0"));
  });

  it("li follows GNU for small, large and low-bits-zero constants", () => {
    expect(words("li a0, 2047")).toEqual(words("addi a0, zero, 2047"));
    expect(words("li a0, 0x800")).toEqual(words("lui a0, 1\naddi a0, a0, -2048"));
    expect(words("li a0, 0x12345000")).toEqual(words("lui a0, 0x12345"));
    expect(words("li a0, -2049")).toEqual(words("lui a0, 0xfffff\naddi a0, a0, 2047"));
  });

  it("resolves branch and jump labels forwards and backwards", () => {
    const r = assemble("top: nop\nbeq zero, zero, top\nj end\nnop\nend: nop");
    expect(r.errors).toEqual([]);
    expect(r.symbols.end).toBe(16);
    expect(r.imem[1]).toBe(assemble("beq zero, zero, -4").imem[0]);
  });

  it("reports data-section labels as absolute addresses", () => {
    const r = assemble(".data\nx: .word 1\ny: .byte 2\n.text\nla a0, y");
    expect(r.symbols.x).toBe(DATA_BASE);
    expect(r.symbols.y).toBe(DATA_BASE + 4);
  });

  it("uses numeric local labels with 1b and 1f", () => {
    const r = assemble("1: addi a0, a0, 1\nbnez a0, 1b\nj 1f\n1: nop");
    expect(r.errors).toEqual([]);
    expect(r.imem[1]).toBe(assemble("bnez a0, -4").imem[0]);
  });
});

describe("assembler: directives and expressions", () => {
  it("evaluates C-like expressions", () => {
    const none = () => {
      throw new Error("no symbols");
    };
    expect(evalExpr("1 + 2 * 3", none)).toBe(7);
    expect(evalExpr("(1 << 12) - 1", none)).toBe(4095);
    expect(evalExpr("'a' + 1", none)).toBe(98);
    expect(evalExpr("0xf0 | 0x0f", none)).toBe(255);
    expect(evalExpr("-(3)", none)).toBe(-3);
  });

  it("lays out .data with alignment and zero fill", () => {
    const r = assemble(".data\n.byte 1\n.align 2\n.word 0x11223344\n.space 2, 0xee\n.asciz \"A\"");
    expect(r.errors).toEqual([]);
    expect(Array.from(r.dmem.subarray(0, 12))).toEqual([1, 0, 0, 0, 0x44, 0x33, 0x22, 0x11, 0xee, 0xee, 65, 0]);
  });

  it("rejects a value that does not fit its directive", () => {
    expect(assemble(".data\n.byte 256").errors[0]?.message).toMatch(/does not fit/);
  });
});

describe("assembler: errors carry line numbers", () => {
  it("reports every error with its line and keeps going", () => {
    const r = assemble("nop\nfrobnicate a0\naddi a0, a0, 5000\nbeq a0, a0, nowhere\nlw a0, 0(a0\n");
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(r.errors[0]?.message).toMatch(/unknown instruction 'frobnicate'/);
    expect(r.errors[1]?.message).toMatch(/out of range/);
    expect(r.errors[2]?.message).toMatch(/undefined symbol 'nowhere'/);
  });

  it("flags unsupported counter writes and CSRs", () => {
    expect(assemble("csrrs a0, cycle, a1").errors[0]?.message).toMatch(/read-only/);
    expect(assemble("csrr a0, mstatus").errors[0]?.message).toMatch(/not a supported counter/);
  });

  it("refuses duplicate labels and instructions outside .text", () => {
    expect(assemble("a: nop\na: nop").errors[0]?.message).toMatch(/already defined/);
    expect(assemble(".data\nnop").errors[0]?.message).toMatch(/outside .text/);
  });

  it("refuses programs larger than the memories", () => {
    const big = Array(1025).fill("nop").join("\n");
    expect(assemble(big).errors.some((e) => /IMEM holds/.test(e.message))).toBe(true);
  });

  it("maps each instruction's pc to its source line", () => {
    const r = assemble("# comment\n\nnop\n  li a0, 0x12345678 # two words\nnop");
    expect(r.lineOf).toEqual({ 0: 3, 4: 4, 8: 4, 12: 5 });
  });
});
