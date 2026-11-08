import { readFileSync } from "node:fs";
import { assemble } from "../../web/src/lib/assembler";
import { runProgram } from "../../web/src/lib/runner";
import { buildRunModel } from "../../web/src/lib/run-model";
import { loadTinyCpu } from "../../web/src/lib/wasm-loader";
import { disassemble } from "../../web/src/lib/disassembler";

const mod = await loadTinyCpu(new URL("../../web/public/tiny_cpu.mjs", import.meta.url).href);
for (const name of ["hello", "fib", "sort", "memcpy", "primes"]) {
  const src = readFileSync(`../web/src/lib/presets/${name}.s`, "utf8");
  const asm = assemble(src);
  for (const [core, fwd] of [["SINGLE", true], ["PIPE", true], ["PIPE", false]] as const) {
    const run = runProgram(mod, asm, { core, forwarding: fwd, maxCycles: 200000 });
    const m = buildRunModel(run.states, asm.dmem);
    const s = m.stats(run.states.length - 1);
    console.log(name, core, fwd, "cycles", run.states.length, "instret", s.instret, "cpi", s.cpi.toFixed(2), "stalls", s.stalls, "flush", s.flushes, "fwd", s.forwards, JSON.stringify(m.consoleAt(run.states.length - 1)));
  }
}
// interesting cycles in fib pipe fwd
const src = readFileSync(`../web/src/lib/presets/fib.s`, "utf8");
const asm = assemble(src);
const run = runProgram(mod, asm, { core: "PIPE", forwarding: true, maxCycles: 200000 });
run.states.slice(0, 60).forEach((s, i) => {
  const h = s.hazard;
  console.log(i, s.cycle, s.stages.map((st) => (st.valid ? disassemble(st.insn || (asm.imem[st.pc >>> 2] ?? 0), st.pc) : "bubble")).join(" | "), JSON.stringify({ st: h.stall, lu: h.loadUse, fl: h.flushIFID, a: h.fwdA, b: h.fwdB }));
});
console.log("sample state", JSON.stringify(run.states[10]).slice(0, 700));
