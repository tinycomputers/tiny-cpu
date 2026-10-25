// Round trip: every instruction word in the GNU reference disassembles to text that assembles back to
// the same word. Branch and jump targets are printed as absolute addresses, so the text is assembled at
// pc 0, where the absolute target equals the pc-relative offset.
import { describe, expect, it } from "vitest";
import { assemble } from "../assembler";
import { decodeWord, disassemble } from "../disassembler";
import fixtures from "./gnu-asm.json";

const table = fixtures as Record<string, { text: string }>;

function wordsOf(hex: string): number[] {
  const b = Uint8Array.from(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  const out: number[] = [];
  for (let i = 0; i + 3 < b.length; i += 4) out.push(((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0);
  return out;
}

describe("disassembler", () => {
  it("round-trips every instruction in the GNU reference", () => {
    let checked = 0;
    for (const [name, fx] of Object.entries(table)) {
      for (const w of wordsOf(fx.text)) {
        if (!decodeWord(w)) continue; // data or unsupported words in text
        const text = disassemble(w, 0);
        const back = assemble(`${text}\n`);
        expect(back.errors, `${name}: "${text}"`).toEqual([]);
        expect(back.imem[0], `${name}: "${text}" -> ${back.imem[0]?.toString(16)} != ${w.toString(16)}`).toBe(w >>> 0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("prints the same text as the golden model for representative words", () => {
    expect(disassemble(0x00500093)).toBe("addi ra, zero, 5");
    expect(disassemble(0x00812283)).toBe("lw t0, 8(sp)");
    expect(disassemble(0x00512423)).toBe("sw t0, 8(sp)");
    expect(disassemble(0x0ff0000f)).toBe("fence");
    expect(disassemble(0x00000073)).toBe("ecall");
    expect(disassemble(0x0000006f, 0x20)).toBe("jal zero, 0x20");
    expect(disassemble(0x00000000)).toBe(".word 0x00000000");
  });
});
