// Phase 8: every state a real run produces passes the schema validator, and the programs used on the
// landing and docs pages assemble and halt with PASS on the WASM core.
import { describe, expect, it } from "vitest";
import { assemble } from "../assembler";
import { HAZARD_CASES } from "../hazard-lab";
import { runProgram } from "../runner";
import { isCycleState } from "../state-schema";
import { loadTinyCpu } from "../wasm-loader";
import fibSource from "../presets/fib.s?raw";
import helloSource from "../presets/hello.s?raw";

const moduleUrl = new URL("../../../public/tiny_cpu.mjs", import.meta.url).href;
const mod = await loadTinyCpu(moduleUrl);

describe("states from a real run", () => {
  it("every CycleState from the pipeline run passes the validator", () => {
    const asm = assemble(fibSource);
    const run = runProgram(mod, asm, { core: "PIPE", forwarding: true, maxCycles: 20_000 });
    expect(run.states.every((s) => isCycleState(s))).toBe(true);
  });

  it("the single-cycle run validates too, and the validator rejects a corrupted state", () => {
    const asm = assemble(helloSource);
    const run = runProgram(mod, asm, { core: "SINGLE", forwarding: true, maxCycles: 20_000 });
    expect(run.states.every((s) => isCycleState(s))).toBe(true);
    const broken = { ...run.states[0], regs: run.states[0]?.regs.slice(0, 31) };
    expect(isCycleState(broken)).toBe(false);
  });
});

describe("programs on the landing and docs pages", () => {
  it("fib halts with PASS on the pipeline with forwarding", () => {
    const run = runProgram(mod, assemble(fibSource), { core: "PIPE", forwarding: true, maxCycles: 20_000 });
    expect(run.halted).toBe(true);
    expect(run.tohost).toBe(1);
  });

  it("hello halts with PASS on the single-cycle core", () => {
    const run = runProgram(mod, assemble(helloSource), { core: "SINGLE", forwarding: true, maxCycles: 20_000 });
    expect(run.halted).toBe(true);
    expect(run.tohost).toBe(1);
  });

  it("the load-use hazard program used on the hazards page assembles and halts", () => {
    const c = HAZARD_CASES.find((x) => x.id === "load-use");
    expect(c).toBeDefined();
    const asm = assemble(c?.source ?? "");
    expect(asm.errors).toEqual([]);
    const run = runProgram(mod, asm, { core: "PIPE", forwarding: true, maxCycles: 2_000 });
    expect(run.halted).toBe(true);
  });
});
