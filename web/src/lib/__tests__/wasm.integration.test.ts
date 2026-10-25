// End to end: the presets, assembled here, run on the real WebAssembly module (both cores, forwarding on
// and off) and print exactly the expected output. This runs in Node against web/public/tiny_cpu.mjs.
import { describe, expect, it } from "vitest";
import { assemble } from "../assembler";
import fibSource from "../presets/fib.s?raw";
import helloSource from "../presets/hello.s?raw";
import memcpySource from "../presets/memcpy.s?raw";
import primesSource from "../presets/primes.s?raw";
import sortSource from "../presets/sort.s?raw";
import { buildRunModel } from "../run-model";
import { runProgram } from "../runner";
import { loadTinyCpu } from "../wasm-loader";
import type { CoreName } from "../state-schema";

const SOURCES: Record<string, string> = { hello: helloSource, fib: fibSource, sort: sortSource, memcpy: memcpySource, primes: primesSource };
const moduleUrl = new URL("../../../public/tiny_cpu.mjs", import.meta.url).href;

const EXPECTED: Record<string, string> = {
  hello: "Hello, TinyCPU!\n",
  fib: "6765\n",
  sort: "1 3 5 7 11 18 27 42 50 64 85 99 \n",
  memcpy: "OK\n",
  primes: "2 3 5 7 11 13 17 19 23 29 31 37 41 43 47 53 59 \n",
};

const RUNS: [CoreName, boolean][] = [
  ["SINGLE", true],
  ["PIPE", true],
  ["PIPE", false],
];

describe("presets on the WASM core", async () => {
  const mod = await loadTinyCpu(moduleUrl);

  it.each(Object.keys(EXPECTED))("%s prints its answer and passes on every core", (name) => {
    const asm = assemble(SOURCES[name] as string);
    expect(asm.errors).toEqual([]);
    for (const [core, forwarding] of RUNS) {
      const run = runProgram(mod, asm, { core, forwarding, maxCycles: 200_000 });
      const label = `${name} ${core}${core === "PIPE" ? (forwarding ? " fwd" : " nofwd") : ""}`;
      expect(run.halted && !run.fault, label).toBe(true);
      expect(run.tohost, label).toBe(1);
      const model = buildRunModel(run.states, asm.dmem);
      expect(model.consoleAt(run.states.length - 1), label).toBe(EXPECTED[name]);
    }
  });

  it("forwarding changes the cycle count of a hazard-heavy preset but not its output", () => {
    const asm = assemble(sortSource);
    const fwd = runProgram(mod, asm, { core: "PIPE", forwarding: true, maxCycles: 200_000 });
    const nofwd = runProgram(mod, asm, { core: "PIPE", forwarding: false, maxCycles: 200_000 });
    expect(nofwd.states.length).toBeGreaterThan(fwd.states.length);
    expect(buildRunModel(fwd.states, asm.dmem).consoleAt(fwd.states.length - 1)).toBe(
      buildRunModel(nofwd.states, asm.dmem).consoleAt(nofwd.states.length - 1),
    );
  });

  it("the model's statistics match the run", () => {
    const asm = assemble(fibSource);
    const run = runProgram(mod, asm, { core: "SINGLE", forwarding: true, maxCycles: 200_000 });
    const stats = buildRunModel(run.states, asm.dmem).stats(run.states.length - 1);
    expect(stats.cycles).toBe(stats.instret); // the single-cycle core has CPI 1
    expect(stats.cpi).toBe(1);
  });
});
