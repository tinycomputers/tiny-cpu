// Headless check of the WASM build (Phase 5). Run after `bash wasm/build.sh`:
//
//     node wasm/test.mjs
//
// For every fixture in wasm/test/fixtures.json (generated from the golden ISS) and every core - SINGLE,
// and PIPE with forwarding on and off - it checks: the console output, the final registers (except
// timing-dependent ones), data memory, the instruction count, the SHA-256 of the retire stream, the
// halt/tohost behaviour, and the cycle count from the pipeline model. Exit status 0 = all good.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixtures = JSON.parse(readFileSync(join(here, "test", "fixtures.json"), "utf8"));
const { default: createTinyCpu } = await import(pathToFileURL(join(root, "web", "public", "tiny_cpu.mjs")).href);
const mod = await createTinyCpu();

const MAX_CYCLES = 200_000;
let failures = 0;
let checks = 0;

function check(cond, msg) {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error(`  FAIL: ${msg}`);
  }
}

function words(hex) {
  const b = Buffer.from(hex, "hex");
  const out = [];
  for (let i = 0; i + 3 < b.length; i += 4) out.push(b.readUInt32LE(i));
  return out;
}

// Must match sim/golden/wasm_fixtures.py retire_digest(): 13 little-endian u32 per retire record.
function retireDigest(states) {
  const h = createHash("sha256");
  const buf = Buffer.alloc(13 * 4);
  for (const s of states) {
    const r = s.retired;
    if (!r) continue;
    const fields = [
      r.order, r.pc, r.insn, r.rdAddr, r.cycleDep ? 0 : r.rdWdata, r.pcWdata, r.memAddr,
      r.memRmask, r.memWmask, r.cycleDep ? 0 : r.memRdata, r.memWdata, r.misaligned ? 1 : 0, r.halt ? 1 : 0,
    ];
    fields.forEach((v, i) => buf.writeUInt32LE(v >>> 0, 4 * i));
    h.update(buf);
  }
  return h.digest("hex");
}

function runOne(name, fx, core, forward) {
  const tag = `${name} ${core}${core === "PIPE" ? (forward ? " fwd" : " nofwd") : ""}`;
  const sim = new mod.TinyCpuSim();
  try {
    sim.setForwarding(forward);
    check(sim.reset(core) === true, `${tag}: reset accepts ${core}`);
    check(sim.loadImem(words(fx.imem)) === true, `${tag}: loadImem`);
    check(sim.loadDmem(Array.from(Buffer.from(fx.dmem, "hex"))) === true, `${tag}: loadDmem`);
    sim.start();
    const states = sim.run(MAX_CYCLES);
    const last = states[states.length - 1];

    check(last && last.halted && !last.fault, `${tag}: halted without fault`);
    check(last.tohost === 1, `${tag}: tohost == 1 (PASS), got ${last.tohost}`);
    check(states.every((s, i) => s.cycle === i + 1), `${tag}: cycle counter counts edges from 1`);

    const retired = states.filter((s) => s.retired).map((s) => s.retired);
    check(retired.length === fx.instret, `${tag}: instret ${retired.length} != ${fx.instret}`);
    check(last.counters.instret === fx.instret, `${tag}: counters.instret`);

    const console_ = states.filter((s) => s.console !== null).map((s) => String.fromCharCode(s.console)).join("");
    check(console_ === fx.console, `${tag}: console ${JSON.stringify(console_)} != ${JSON.stringify(fx.console)}`);
    check(sim.getConsole() === fx.console, `${tag}: getConsole()`);

    const regs = sim.getRegs();
    const timing = new Set(fx.timingRegs);
    for (let r = 0; r < 32; r++) {
      if (!timing.has(r)) check(regs[r] === fx.regs[r], `${tag}: x${r} = ${regs[r]} != ${fx.regs[r]}`);
    }

    if (fx.expect.dmemAddr !== undefined) {
      const got = Buffer.from(sim.readDmem(fx.expect.dmemAddr, fx.expect.dmemHex.length / 2)).toString("hex");
      check(got === fx.expect.dmemHex, `${tag}: data memory ${got} != ${fx.expect.dmemHex}`);
    }

    check(retireDigest(states) === fx.digest, `${tag}: retire digest mismatch`);

    const want = core === "SINGLE" ? fx.cycles.single : forward ? fx.cycles.pipeFwd : fx.cycles.pipeNoFwd;
    check(states.length === want, `${tag}: ${states.length} cycles, model says ${want}`);
    return states.length;
  } finally {
    sim.delete();
  }
}

for (const [name, fx] of Object.entries(fixtures)) {
  console.log(name);
  runOne(name, fx, "SINGLE", true);
  runOne(name, fx, "PIPE", true);
  runOne(name, fx, "PIPE", false);
}

// API edges: unknown core, oversized images, step() before start(), step() after halt.
{
  const sim = new mod.TinyCpuSim();
  check(sim.reset("MULTI") === false, "unknown core is rejected");
  check(sim.loadImem(new Array(1025).fill(0)) === false, "oversized IMEM is rejected");
  check(sim.loadDmem(new Array(4097).fill(0)) === false, "oversized DMEM is rejected");
  check(sim.step() === null, "step() before start() returns null");
  const fx = fixtures["hazard_free/fib"];
  sim.reset("SINGLE");
  sim.loadImem(words(fx.imem));
  sim.loadDmem(Array.from(Buffer.from(fx.dmem, "hex")));
  sim.start();
  const first = sim.step();
  check(first.cycle === 1 && first.halted === false, "first step is cycle 1");
  check(first.hazard.stall === false && first.stages[0].name === "IF", "state shape");
  const summary = sim.runFast(MAX_CYCLES);
  check(summary.halted && summary.cycles === fixtures["hazard_free/fib"].cycles.single, "runFast cycle count");
  check(summary.tohost === 1 && summary.console === "", "runFast summary fields");
  const halted = sim.step();
  check(halted.halted && halted.cycle === summary.cycles, "step() after halt does not advance");
  sim.delete();
}

console.log(`${checks} checks, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
