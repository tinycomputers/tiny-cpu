// Exports real run data for the video. Everything on screen that looks like CPU output comes from here:
// the programs are assembled with the web app's own assembler and executed on the committed WASM build
// of the RTL (web/public/tiny_cpu.mjs), exactly like the app does. Nothing is typed in by hand.
//
//   npx tsx scripts/gen-data.ts   ->   src/data/run-data.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { assemble } from "../../web/src/lib/assembler";
import { runProgram } from "../../web/src/lib/runner";
import { accessCounts, buildRunModel } from "../../web/src/lib/run-model";
import { loadTinyCpu } from "../../web/src/lib/wasm-loader";
import { datapathFor, lastRetireOrder } from "../../web/src/lib/datapath";
import { HAZARD_CASES, runHazardCase } from "../../web/src/lib/hazard-lab";
import { cyclesToMicroseconds, ICE40_FMAX_MHZ } from "../../web/src/lib/fpga";
import type { CycleState } from "../../web/src/lib/state-schema";

const PRESET_IDS = ["hello", "fib", "sort", "memcpy", "primes"] as const;
const TITLES: Record<string, string> = { hello: "Hello", fib: "Fibonacci", sort: "Bubble sort", memcpy: "memcpy", primes: "Primes" };
const DESCRIPTIONS: Record<string, string> = {
  hello: "Prints a string with a byte loop and a call.",
  fib: "fib(20) in a loop, printed in decimal by repeated subtraction.",
  sort: "Sorts 12 words in data memory, then prints them. Data hazards everywhere.",
  memcpy: "Byte copy, then a word-by-word check that prints OK.",
  primes: "Sieve of Eratosthenes up to 60.",
};
const source = (id: string) => readFileSync(new URL(`../../web/src/lib/presets/${id}.s`, import.meta.url), "utf8");

const mod = await loadTinyCpu(new URL("../../web/public/tiny_cpu.mjs", import.meta.url).href);
const MAX = 200_000;

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

// A "window" is one exported cycle with everything the app's panels need to draw it.
function windowAt(run: ReturnType<typeof runProgram>, model: ReturnType<typeof buildRunModel>, index: number, memLen: number) {
  return {
    index,
    state: run.states[index] as CycleState,
    stats: model.stats(index),
    console: model.consoleAt(index),
    mem: hex(model.memoryAt(index).slice(0, memLen)),
  };
}

// ---- Fibonacci on the pipeline: the hero run
const HERO = "sort"; // bubble sort: real data-memory traffic, load-use stalls, forwarding, flushes
const fibSrc = source(HERO);
const fibAsm = assemble(fibSrc);
if (!fibAsm.ok) throw new Error(`${HERO} does not assemble`);
const fibPipe = runProgram(mod, fibAsm, { core: "PIPE", forwarding: true, maxCycles: MAX });
const fibModel = buildRunModel(fibPipe.states, fibAsm.dmem);
const total = fibPipe.states.length;
const memLen = Math.min(4096, Math.max(128, Math.ceil(fibAsm.dataBytes / 16) * 16 + 64));
const first = Array.from({ length: 96 }, (_, i) => i);
const lastIdx = Array.from({ length: 12 }, (_, i) => total - 12 + i);
const fibWindows = [...first, ...lastIdx].map((i) => windowAt(fibPipe, fibModel, i, memLen));

// The same program with forwarding off (the "turn forwarding off" moment): start and finish are enough
const noFwdRun = runProgram(mod, fibAsm, { core: "PIPE", forwarding: false, maxCycles: MAX });
const noFwdModel = buildRunModel(noFwdRun.states, fibAsm.dmem);
const noFwdTotal = noFwdRun.states.length;
const noFwdIdx = [...Array.from({ length: 16 }, (_, i) => i), ...Array.from({ length: 12 }, (_, i) => noFwdTotal - 12 + i)];
const noFwd = { total: noFwdTotal, windows: noFwdIdx.map((i) => windowAt(noFwdRun, noFwdModel, i, memLen)) };

// Where the console prints its first character (shown as a real moment near the end of the run)
const firstChar = fibPipe.states.findIndex((s) => s.console !== null);

// ---- Datapath: three instructions from a SINGLE run of fib (add, load byte, taken branch)
const fibSingle = runProgram(mod, fibAsm, { core: "SINGLE", forwarding: true, maxCycles: MAX });
function pickRetire(pred: (info: NonNullable<ReturnType<typeof datapathFor>>) => boolean, nth = 0) {
  let seen = 0;
  for (const s of fibSingle.states) {
    const r = s.retired;
    if (!r) continue;
    const info = datapathFor(fibSingle.states, r.order);
    if (info && pred(info) && seen++ === nth) return info;
  }
  throw new Error("no matching instruction");
}
const datapath = {
  add: pickRetire((d) => d.name === "add" && d.rs1Value > 0 && d.rs2Value > 0, 2),
  load: pickRetire((d) => d.isLoad && d.name === "lw" && (d.memReadValue ?? 0) > 20, 0),
  branch: pickRetire((d) => d.isBranch && d.taken && d.name === "bge", 0),
};
void lastRetireOrder;

// ---- The first real load-use stall in the hero run (a load feeding the very next instruction)
const stallIdx = fibPipe.states.findIndex((s) => s.hazard.loadUse);
const fwdIdx = fibPipe.states.findIndex((s) => s.hazard.fwdA || s.hazard.fwdB);
const flushIdx = fibPipe.states.findIndex((s) => s.hazard.flushIFID);
const swapIdx = fibPipe.states.findIndex((s) => s.retired && s.retired.memWmask !== 0 && s.retired.memAddr >= 0x10000 && s.retired.memAddr < 0x11000 && s.retired.order > 20);

// ---- Hazard lab outcomes (identical to HazardLab.tsx)
const TIMELINE = 8;
const hazard = HAZARD_CASES.map((c) => {
  const o = runHazardCase(mod, c);
  const stat = (r: typeof o.pipeFwd) => buildRunModel(r.states, new Uint8Array(4096)).stats(r.states.length - 1);
  const tl = (r: typeof o.pipeFwd) =>
    Array.from({ length: Math.min(TIMELINE, r.states.length) }, (_, k) =>
      (r.states[k] as CycleState).stages.map((st) => (st.valid ? st.pc & 0xffff : null)),
    );
  return {
    id: c.id,
    title: c.title,
    why: c.why,
    expect: c.expect,
    source: c.source,
    rows: [
      { name: "5-stage, forwarding on", cycles: o.pipeFwd.states.length, ...pick(stat(o.pipeFwd)) },
      { name: "5-stage, forwarding off", cycles: o.pipeNoFwd.states.length, ...pick(stat(o.pipeNoFwd)) },
      { name: "single-cycle", cycles: o.single.states.length, stalls: null, flushes: null },
    ],
    timelineFwd: tl(o.pipeFwd),
    timelineNoFwd: tl(o.pipeNoFwd),
  };
});
function pick(s: { stalls: number; flushes: number }) {
  return { stalls: s.stalls, flushes: s.flushes };
}

// ---- Programs comparison (identical to ProgramsView.tsx), plus the heat map for bubble sort
const programs = PRESET_IDS.map((id) => {
  const asm = assemble(source(id));
  const single = runProgram(mod, asm, { core: "SINGLE", forwarding: true, maxCycles: MAX });
  const pipe = runProgram(mod, asm, { core: "PIPE", forwarding: true, maxCycles: MAX });
  const nofwd = runProgram(mod, asm, { core: "PIPE", forwarding: false, maxCycles: MAX });
  const m = buildRunModel(pipe.states, asm.dmem);
  const s = m.stats(pipe.states.length - 1);
  const counts = accessCounts(pipe.states, asm.dmem.length);
  const usedWords = Math.min(256, Math.max(16, Math.ceil(asm.dmem.length / 4)));
  return {
    id,
    title: TITLES[id] as string,
    description: DESCRIPTIONS[id] as string,
    instructions: s.instret,
    singleCycles: single.states.length,
    pipeCycles: pipe.states.length,
    noFwdCycles: nofwd.states.length,
    pipeCpi: s.cpi,
    stalls: s.stalls,
    flushes: s.flushes,
    pass: pipe.tohost === 1,
    timeUs: cyclesToMicroseconds(pipe.states.length),
    output: m.consoleAt(pipe.states.length - 1),
    heat: { words: usedWords, reads: Array.from(counts.reads.slice(0, usedWords)), writes: Array.from(counts.writes.slice(0, usedWords)) },
  };
});

const out = {
  fmaxMhz: ICE40_FMAX_MHZ,
  helloSource: source("hello"),
  fib: {
    source: fibSrc,
    total,
    firstCharIndex: firstChar,
    instret: fibModel.stats(total - 1).instret,
    lineOf: fibAsm.lineOf,
    imem: Array.from(fibAsm.imem.slice(0, Math.ceil(fibAsm.textBytes / 4))),
    windows: fibWindows,
    finalConsole: fibModel.consoleAt(total - 1),
    memLen,
  },
  noFwd,
  events: { stall: stallIdx, forward: fwdIdx, flush: flushIdx, firstSwap: swapIdx },
  datapath,
  hazard,
  programs,
};

mkdirSync(new URL("../src/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../src/data/run-data.json", import.meta.url), JSON.stringify(out));
console.log(
  `hero(${HERO}): ${total} cycles, ${out.fib.instret} instructions, CPI ${(total / out.fib.instret).toFixed(2)}, first char at cycle index ${firstChar}, console ${JSON.stringify(out.fib.finalConsole)}`,
);
console.log(`events stall ${stallIdx} fwd ${fwdIdx} flush ${flushIdx} swap ${swapIdx}; datapath: ${Object.values(datapath).map((d) => d.text).join(" | ")}`);
console.log(`programs: ${programs.map((p) => `${p.id} ${p.pipeCycles}/${p.noFwdCycles}`).join(", ")}`);
console.log(`hazard cases: ${hazard.map((h) => `${h.id}[${h.rows.map((r) => r.cycles).join("/")}]`).join(" ")}`);
