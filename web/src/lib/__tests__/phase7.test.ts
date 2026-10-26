// Phase 7 logic against the real WASM core: the datapath view's operand and result values, the hazard lab's
// measured behaviour per case, the programs comparison, and the data-access counts.
import { describe, expect, it } from "vitest";
import { assemble } from "../assembler";
import { datapathFor, lastRetireOrder } from "../datapath";
import { HAZARD_CASES, runHazardCase } from "../hazard-lab";
import { accessCounts, buildRunModel, DATA_BASE } from "../run-model";
import { comparePresets } from "../programs-compare";
import { PRESETS } from "../programs";
import { runProgram } from "../runner";
import { loadTinyCpu } from "../wasm-loader";

const moduleUrl = new URL("../../../public/tiny_cpu.mjs", import.meta.url).href;
const mod = await loadTinyCpu(moduleUrl);

const preset = (id: string) => PRESETS.find((p) => p.id === id)?.source ?? "";

describe("datapath (single-cycle core)", () => {
  const asm = assemble(preset("fib"));
  const run = runProgram(mod, asm, { core: "SINGLE", forwarding: true, maxCycles: 200_000 });

  it("reads operands from the register file as it was before the instruction", () => {
    for (let k = 0; k < 60; k++) {
      const d = datapathFor(run.states, k);
      expect(d, `order ${k}`).not.toBeNull();
      if (!d) continue;
      const before = k > 0 ? run.states[k - 1]?.regs : undefined;
      if (before && d.usesRs1) expect(d.rs1Value).toBe(before[d.rs1]);
      if (before && d.usesRs2) expect(d.rs2Value).toBe(before[d.rs2]);
    }
  });

  it("gives register-register and immediate ALU results that match the arithmetic", () => {
    let checked = 0;
    for (let k = 0; k < run.states.length; k++) {
      const d = datapathFor(run.states, k);
      if (!d || !d.writesRd) continue;
      if (d.name === "add") {
        expect(d.writeValue).toBe((d.rs1Value + d.rs2Value) >>> 0);
        checked++;
      }
      if (d.name === "addi") {
        expect(d.writeValue).toBe((d.rs1Value + d.imm) >>> 0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("reports effective addresses for loads and stores inside data memory", () => {
    let mem = 0;
    for (let k = 0; k < run.states.length; k++) {
      const d = datapathFor(run.states, k);
      if (!d || d.memAddr === null) continue;
      expect(d.memAddr).toBeGreaterThanOrEqual(DATA_BASE);
      mem++;
    }
    expect(mem).toBeGreaterThan(0);
  });

  it("marks taken branches and jumps by comparing the next pc with pc + 4", () => {
    let taken = 0;
    for (let k = 0; k < run.states.length; k++) {
      const d = datapathFor(run.states, k);
      if (!d || !(d.isBranch || d.isJump)) continue;
      expect(d.taken).toBe(d.nextPc !== d.pc + 4);
      if (d.taken) taken++;
    }
    expect(taken).toBeGreaterThan(0);
  });

  it("finds the last retire at or before a cycle", () => {
    expect(lastRetireOrder(run.states, 0)).toBe(run.states[0]?.retired ? 0 : undefined);
    expect(lastRetireOrder(run.states, run.states.length - 1)).toBe(run.states[run.states.length - 1]?.retired?.order);
  });
});

describe("hazard lab (measured on the core)", () => {
  const out = Object.fromEntries(HAZARD_CASES.map((c) => [c.id, runHazardCase(mod, c)]));
  const cycles = (id: string, which: "pipeFwd" | "pipeNoFwd" | "single") => out[id]?.[which].states.length ?? -1;
  const stalls = (id: string, fwd: boolean) => {
    const r = fwd ? out[id]?.pipeFwd : out[id]?.pipeNoFwd;
    return r ? buildRunModel(r.states, new Uint8Array(4096)).stats(r.states.length - 1).stalls : -1;
  };

  it("runs every case to a clean halt on all three configurations", () => {
    for (const c of HAZARD_CASES) {
      for (const r of [out[c.id]?.pipeFwd, out[c.id]?.pipeNoFwd, out[c.id]?.single]) {
        expect(r?.halted && !r.fault, c.id).toBe(true);
      }
    }
  });

  it("forwarding removes the distance-1 ALU stall", () => {
    expect(cycles("alu-raw-1", "pipeNoFwd")).toBeGreaterThan(cycles("alu-raw-1", "pipeFwd"));
    expect(stalls("alu-raw-1", true)).toBe(0);
  });

  it("distance 2 costs less than distance 1 without forwarding, and nothing with it", () => {
    expect(cycles("alu-raw-2", "pipeNoFwd") - cycles("alu-raw-2", "single")).toBeLessThan(
      cycles("alu-raw-1", "pipeNoFwd") - cycles("alu-raw-1", "single"),
    );
    expect(stalls("alu-raw-2", true)).toBe(0);
  });

  it("the load-use case stalls once with forwarding and is slower without", () => {
    expect(stalls("load-use", true)).toBe(1);
    expect(cycles("load-use", "pipeNoFwd")).toBeGreaterThan(cycles("load-use", "pipeFwd"));
  });

  it("a taken branch costs the same flush with and without forwarding; a not-taken one costs none", () => {
    const takenFwd = cycles("branch-taken", "pipeFwd") - cycles("branch-taken", "single");
    const takenNo = cycles("branch-taken", "pipeNoFwd") - cycles("branch-taken", "single");
    expect(takenFwd).toBe(takenNo);
    expect(takenFwd).toBeGreaterThan(4);
    expect(cycles("branch-not-taken", "pipeFwd") - cycles("branch-not-taken", "single")).toBe(4);
  });

  it("the independent case is the same with and without forwarding", () => {
    expect(cycles("independent", "pipeFwd")).toBe(cycles("independent", "pipeNoFwd"));
  });
});

describe("programs comparison", () => {
  const rows = comparePresets(mod);

  it("runs every preset to PASS with its expected output", () => {
    for (const row of rows) {
      expect(row.pass, row.id).toBe(true);
      const p = PRESETS.find((x) => x.id === row.id);
      expect(row.output).toBe(p?.output);
    }
  });

  it("pipeline cycles are at least the instruction count plus the fill", () => {
    for (const row of rows) expect(row.pipeCycles).toBeGreaterThanOrEqual(row.instructions + 4);
  });
});

describe("data access counts", () => {
  it("counts every retired load and store that touches data memory", () => {
    const asm = assemble(preset("sort"));
    const run = runProgram(mod, asm, { core: "SINGLE", forwarding: true, maxCycles: 200_000 });
    const { reads, writes } = accessCounts(run.states, asm.dmem.length);
    const expected = run.states.filter((s) => s.retired && (s.retired.memRmask || s.retired.memWmask)).length;
    const total = reads.reduce((a, b) => a + b, 0) + writes.reduce((a, b) => a + b, 0);
    // stores to MMIO (console) are not data memory and are excluded from the count
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(expected);
  });
});
