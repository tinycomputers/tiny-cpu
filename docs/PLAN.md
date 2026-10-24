# TinyCPU — End-to-End Build Plan

> **A real, synthesizable RV32I RISC-V CPU in SystemVerilog, compiled to WebAssembly,
> running your own assembly live in the browser.**
> Third project in the series after [tiny-gpu](https://github.com/deaneeth/tiny-gpu) and
> [tiny-tpu](https://github.com/deaneeth/tiny-tpu). It reuses tiny-tpu's toolchain one to one:
> `rtl/*.sv → Verilator → C++ harness → Emscripten → web/public/tiny_cpu.wasm → React island → SVG`.

Same rule as tiny-tpu: **nothing on screen is faked.** Every pipeline register, forwarding
path, stall and flush the UI draws comes from a `dbg_*` port on the compiled RTL.

---

## 1. Goals and non-goals

### Goals
1. **Two real cores, one ISA.** A **single-cycle** reference core and a **5-stage pipelined** core,
   both RV32I, sharing the same ALU, decoder and register file. Running the same program on
   both makes CPI and hazards concrete.
2. **Verified for real.** The core passes the official `riscv-tests` `rv32ui-p-*` suite, matches a
   Python golden ISS in lockstep on every retired instruction, and survives randomized programs.
3. **Write code, watch it run.** The browser has an assembly editor, an in-browser assembler,
   step/run/rewind, and four views: datapath, pipeline, hazard lab and programs.
4. **Synthesizable.** Builds with Yosys + nextpnr for an iCE40 or ECP5 FPGA. The LUT count and
   fmax go in the README.

### Non-goals (v1)
- No privileged spec: no traps, interrupts, MMU or S/U modes. `ecall`/`ebreak` simply halt.
- No caches or branch predictor in v1. Both are stretch goals (§12).
- No compressed instructions (C), no M extension in v1. M is the first stretch goal.
- No `fence.i` or self-modifying code (Harvard memories).

---

## 2. Architecture

### 2.1 Memory map (Harvard: separate instruction and data ports, one address space)

| Region | Base | Size | Notes |
|---|---|---|---|
| IMEM | `0x0000_0000` | 4 KiB (1024 words) | Loaded by the harness; read-only to the core |
| DMEM | `0x0001_0000` | 4 KiB | Byte-addressable, LB/LH/LW/SB/SH/SW |
| MMIO `CONSOLE` | `0x0002_0000` | 1 word | Writing a byte sends it to the browser console panel |
| MMIO `TOHOST` | `0x0002_0004` | 1 word | Writing here halts the core. `1` = PASS, anything else = FAIL code (the riscv-tests convention) |
| MMIO `CYCLE` | `0x0002_0008` | 1 word | Read-only cycle counter (also mapped as CSR `cycle`) |

All three sizes are `parameter`s in `tiny_cpu_pkg.sv`. 4 KiB each keeps the WASM small and
fits iCE40 BRAM.

### 2.2 Pipeline (classic 5-stage)

```
 ┌────┐  IF/ID  ┌────┐  ID/EX  ┌────┐  EX/MEM  ┌─────┐  MEM/WB  ┌────┐
 │ IF │────────▶│ ID │────────▶│ EX │─────────▶│ MEM │─────────▶│ WB │
 └────┘         └────┘         └────┘          └─────┘          └────┘
   ▲  pc_next      │ regfile read  │ ALU, branch     │ DMEM / MMIO      │ regfile write
   │               │ imm gen       │ resolve         │                  │
   └── redirect ◀──┼───────────────┘                 │                  │
                   │        forwarding ◀── EX/MEM ───┘◀── MEM/WB ───────┘
                   └── hazard unit (load-use stall)
```

**Design decisions (record each one in `docs/ARCHITECTURE.md`):**

| Decision | Choice | Why |
|---|---|---|
| Memory read timing | **Synchronous** read on both IMEM and DMEM | Maps straight to FPGA BRAM. IMEM is addressed with `pc_next`, so the instruction is ready in IF/ID. DMEM is addressed in EX, so data is ready in MEM. |
| Branch / JAL / JALR resolution | In **EX**, predict not-taken | Simplest correct design. A taken branch flushes IF/ID and ID/EX (2-cycle penalty), which is very visible in the UI. |
| Forwarding | EX/MEM→EX and MEM/WB→EX, for both rs1 and rs2 | Standard design. Store data (rs2) is forwarded as well. |
| Register-file write/read in the same cycle | Write-first bypass inside `regfile.sv` | Removes the WB→ID hazard without an extra forwarding path. |
| Load-use hazard | 1-cycle stall: freeze PC and IF/ID, insert a bubble into ID/EX | The only stall in v1. |
| `x0` | Hard-wired to zero in the register file. Forwarding ignores `rd == 0` | A common bug source; covered by tests. |
| Runtime knob `cfg_forward_en` | Top-level input pin. When 0, forwarding is disabled and the hazard unit stalls on **every** RAW hazard | Lets the Hazard Lab toggle forwarding live with one WASM build. |
| Halt | `ecall`, `ebreak` or a `TOHOST` write raises `halted`. The pipeline drains, and `done` asserts after the halting instruction retires | Clear end condition for `run()`. |
| Misaligned load/store | Not supported. The address is forced into alignment and `dbg_misaligned` flags it | `rv32ui-p-ma_data` is excluded from the suite. |

### 2.3 Single-cycle reference core
`core_single.sv` uses the same `alu`, `decoder`, `imm_gen`, `branch_unit` and `regfile`, with
**combinational** reads from a separate `mem_comb.sv` model (simulation only; it is not built for
the FPGA). CPI is exactly 1. It exists to teach and to compare, and it is also the first core you
build (Phase 2).

### 2.4 Retire trace (RVFI-lite)
Each core outputs one retire record per cycle. This is the backbone of all verification and of
the UI's "retired" log:

```
rvfi_valid, rvfi_order, rvfi_pc, rvfi_insn,
rvfi_rd_addr, rvfi_rd_wdata,
rvfi_mem_addr, rvfi_mem_rmask, rvfi_mem_wmask, rvfi_mem_rdata, rvfi_mem_wdata,
rvfi_halt
```

Phase 1 additions (implemented in `sim/golden/iss.py`): `pc_wdata` (next PC), `misaligned` (load/store was forced into alignment) and `cycle_dependent` (rd value depends on timing: `rdcycle`/`rdtime`/CYCLE MMIO; lockstep masks it). `mem_addr` is the word-aligned address, masks are byte lanes within it, and `mem_rdata`/`mem_wdata` are lane-positioned words.

---

## 3. Repository layout (mirrors tiny-tpu)

```
tiny-cpu/
├── AGENTS.md / CLAUDE.md / CONTEXT.md   # same conventions as tiny-tpu
├── README.md  LICENSE  .editorconfig
├── .github/workflows/
│   ├── rtl.yml        # lint + cocotb unit + riscv-tests + lockstep + random
│   ├── wasm.yml       # Verilator + emsdk build, artifact size check
│   ├── web.yml        # lint, typecheck, unit tests, build
│   └── fpga.yml       # yosys/nextpnr synth, posts LUT/fmax (Phase 9)
├── rtl/
│   ├── tiny_cpu_pkg.sv     # opcodes, ALU ops, params, enums
│   ├── alu.sv
│   ├── regfile.sv          # 32×32, x0=0, write-first bypass, dbg read-all port
│   ├── imm_gen.sv          # I/S/B/U/J immediates
│   ├── decoder.sv          # instr → control bundle (struct)
│   ├── branch_unit.sv      # BEQ/BNE/BLT/BGE/BLTU/BGEU
│   ├── lsu.sv              # byte/half/word align, sign-extend, wmask
│   ├── forward_unit.sv
│   ├── hazard_unit.sv
│   ├── mem_sync.sv         # BRAM-style sync memory (IMEM/DMEM)
│   ├── mem_comb.sv         # sim-only comb memory for single-cycle core
│   ├── mmio.sv             # CONSOLE / TOHOST / CYCLE
│   ├── csr_counters.sv     # rdcycle / rdinstret (Zicntr subset)
│   ├── core_single.sv
│   ├── core_pipe.sv
│   ├── tiny_cpu_top.sv     # parameter CORE = "PIPE" | "SINGLE"; dbg_* ports
│   └── spike/              # toolchain smoke test (counter.sv), as in tiny-tpu
├── sim/
│   ├── Makefile  conftest.py
│   ├── golden/
│   │   ├── iss.py          # Python RV32I ISS (the golden model)
│   │   ├── decode.py       # shared decode tables (also used to gen TS tables)
│   │   └── test_iss.py     # ISS self-tests (pytest, no RTL)
│   ├── test_alu.py  test_regfile.py  test_imm_gen.py  test_decoder.py
│   ├── test_branch_unit.py  test_lsu.py  test_hazards.py
│   ├── test_core_lockstep.py   # RTL vs ISS on every retire
│   ├── test_riscv_tests.py     # parametrized over rv32ui-p-*
│   ├── test_random.py          # random program generator + lockstep
│   └── programs/               # .S sources: fib, sort, memcpy, mandelbrot, hazards_*.S
├── sw/
│   ├── link.ld                 # memory map from §2.1
│   ├── crt0.S                  # set sp, call main, write TOHOST
│   ├── riscv-tests/            # git submodule (riscv-software-src/riscv-tests)
│   ├── env/tinycpu/riscv_test.h  # custom test env for our memory map
│   └── Makefile                # builds programs + riscv-tests → .hex/.bin
├── wasm/
│   ├── harness.cpp  bindings.cpp  build.sh  README.md
├── fpga/
│   ├── ice40/  (pcf, Makefile)  ecp5/
├── docs/
│   ├── STATE_SCHEMA.md         # per-cycle contract (§6)
│   ├── ARCHITECTURE.md         # decisions table + diagrams
│   └── VERIFICATION.md
└── web/                        # Astro + React + Tailwind + shadcn (copy tiny-tpu config)
    ├── public/tiny_cpu.mjs  tiny_cpu.wasm
    └── src/
        ├── lib/
        │   ├── state-schema.ts     # mirrors STATE_SCHEMA.md
        │   ├── wasm-loader.ts      # copied from tiny-tpu, renamed
        │   ├── isa.ts              # generated from sim/golden/decode.py
        │   ├── assembler.ts        # RV32I + pseudo-ops + labels
        │   ├── disassembler.ts
        │   └── programs.ts         # bundled example programs
        ├── hooks/useTinyCpu.ts     # sim lifecycle, step/run/rewind, history buffer
        ├── components/ (see §7)
        └── pages/ index.astro  app.astro  docs/*.astro
```

---

## 4. Software toolchain

| Tool | Version | Used for |
|---|---|---|
| Verilator | ≥ 5.x (same as tiny-tpu) | lint, cocotb sim, WASM model |
| cocotb + pytest + numpy | same venv as tiny-tpu (`~/.venvs/tinycpu`) | all RTL tests |
| `riscv64-unknown-elf-gcc` (or `riscv32-…`) | any recent; `-march=rv32i_zicsr -mabi=ilp32` | building riscv-tests and C/asm programs in CI |
| Emscripten | same as tiny-tpu | WASM |
| Yosys + nextpnr + icestorm/trellis | OSS CAD Suite | Phase 9 synthesis |
| pnpm + Astro + React + Vitest | same as tiny-tpu | web |

**The in-browser assembler is TypeScript, not GNU as.** The browser can't run gcc, so
`assembler.ts` handles labels, `.text/.data/.word/.byte/.ascii/.align`, and the pseudo-ops
`li, la, mv, nop, j, jr, ret, call, beqz, bnez, bgt, ble, not, neg, seqz`.
**CI checks it against GNU:** every file in `sim/programs/*.S` is assembled by both, and the
bytes must match exactly.

---

## 5. Verification strategy (the credibility of the project)

Four layers. Each phase below says which layers must be green.

1. **Unit tests (cocotb), one per module:** ALU (all ops, exhaustive shifts, random 10k vectors
   checked against numpy), regfile (x0, write-first bypass), imm_gen (every format, sign edges),
   decoder (every RV32I opcode → expected control bundle, generated from `decode.py`),
   branch_unit, lsu (every size × sign × byte offset).
2. **Golden ISS lockstep:** `iss.py` executes the same program. On every `rvfi_valid` the test
   compares `pc, insn, rd, rd_wdata, mem_*` and stops at the **first divergence**, printing a
   readable diff with the disassembly of the last 8 retired instructions.
3. **Official compliance:** all `rv32ui-p-*` tests from `riscv-tests` on **both** cores, using a
   custom `env/tinycpu` (our `link.ld`, with `RVTEST_PASS/FAIL` writing `TOHOST`).
   Excluded: `fence_i`, `ma_data`. Verified in Phase 1: 40 tests (42 sources minus those two) on riscv-tests `3df703c`; the largest, `ld_st`, is 3732 B and fits the 4 KiB IMEM.
4. **Random programs:** `test_random.py` generates N programs (seeded) of 200–2000 instructions,
   weighted toward hazards: back-to-back RAW, load-use, branch after load, store after load,
   writes to x0, JALR to computed targets. Every program runs in lockstep, with
   `cfg_forward_en` ∈ {0, 1}. CI runs 200 seeds; nightly runs 5000.

**Directed hazard tests** (`sim/programs/hazards_*.S` + `test_hazards.py`) check **exact
cycle counts**, not just results. Example: `lw x1,0(x2); add x3,x1,x1` must take exactly 1
extra cycle with forwarding on and 3 with it off. These numbers are the ones the Hazard Lab
displays, so they get pinned.

**Performance assertions:** fib(20) and bubble sort on 32 elements have pinned cycle counts per
core in `sim/perf_baseline.json`. If one changes unexpectedly, CI fails.

---

## 6. State contract (`docs/STATE_SCHEMA.md` ↔ `web/src/lib/state-schema.ts`)

As in tiny-tpu: the harness emits one `CycleState` per clock, and the two files must stay in sync.

```ts
type StageName = "IF" | "ID" | "EX" | "MEM" | "WB";

interface StageState {
  valid: boolean;      // false = bubble
  pc: number;
  insn: number;        // raw 32-bit; disassembly is derived in JS (documented as derived)
}

interface CycleState {
  cycle: number;
  core: "PIPE" | "SINGLE";
  stages: Record<StageName, StageState>;      // SINGLE: only IF populated
  hazard: {
    stall: boolean;            // dbg_stall
    flushIFID: boolean;        // dbg_flush_ifid
    flushIDEX: boolean;        // dbg_flush_idex
    loadUse: boolean;          // dbg_load_use
    fwdA: "NONE" | "EXMEM" | "MEMWB";   // dbg_fwd_a (2 bits)
    fwdB: "NONE" | "EXMEM" | "MEMWB";
  };
  ex: { aluOp: string; aluA: number; aluB: number; aluY: number;
        branchTaken: boolean; target: number };
  mem: { addr: number; wdata: number; rdata: number;
         wmask: number; rmask: number; mmio: boolean };
  wb: { rd: number; wdata: number; we: boolean };
  regs: number[];              // 32 entries, dbg_regs (read-all port)
  retired: Retire | null;      // RVFI-lite record from §2.4
  console: number | null;      // byte written to CONSOLE this cycle
  counters: { cycle: number; instret: number };
  halted: boolean;
  done: boolean;
}
```

Every field lists its `dbg_*` source in the Markdown, exactly as tiny-tpu does.

---

## 7. WASM harness API

```cpp
class TinyCpuSim {
  void   reset(std::string core /* "PIPE" | "SINGLE" */);
  void   setForwarding(bool on);           // drives cfg_forward_en
  void   loadImem(val uint32Array);        // words from 0x0000_0000
  void   loadDmem(val uint8Array);         // bytes from 0x0001_0000
  val    step();                           // one clock → CycleState
  val    run(int maxCycles);               // CycleState[] until done or limit
  val    runFast(int maxCycles);           // no per-cycle states; returns summary only
  val    getRegs();  val readDmem(int addr, int len);
  int    getCycleCount();  bool isDone();
};
```

- **Two cores, one WASM:** Verilate `tiny_cpu_top` twice (`-DCORE_PIPE` and `-DCORE_SINGLE`,
  with separate `--prefix`) and link both models into one module. `reset(core)` picks one.
- **Rewind is replay.** The design is deterministic, so `useTinyCpu` keeps a ring buffer of the
  last 4096 `CycleState`s. Seeking further back re-runs from reset with `runFast` up to the
  target cycle, then switches to `step`. No snapshot code is needed in C++.
- **Size budget:** under 400 KB `.wasm` gzipped. `wasm.yml` fails the build above that.

---

## 8. Web app (`web/`)

Copy tiny-tpu's Astro/React/Tailwind/shadcn setup and visual language, so the three projects
look like one family.

### Pages
- `/` — landing page: hero GIF of the pipeline running fib, then "Open the CPU" button.
- `/app` — the visualizer (one React island).
- `/docs/how-it-works`, `/docs/architecture`, `/docs/the-pipeline`, `/docs/hazards`,
  `/docs/verification`.

### Visualizer layout
```
┌─────────────────────────────────────────────────────────────────────┐
│ [Program ▾ fib.S] [Core: PIPE|SINGLE] [Forwarding ●] ⏮ ◀ ▶ ⏭ ▶▶ speed │
├──────────────────────┬──────────────────────────────────────────────┤
│  Editor (CodeMirror) │   LevelTabs:  L1 Datapath | L2 Pipeline |    │
│  + assemble errors   │               L3 Hazard Lab | L4 Programs    │
│  current PC line ▶   │   ┌──────────────────────────────────────┐   │
│                      │   │            active view               │   │
├──────────────────────┤   └──────────────────────────────────────┘   │
│ Registers x0–x31     │   Console (MMIO)  │  Stats: cycles, instret, │
│ (flash on write)     │                   │  CPI, stalls, flushes    │
└──────────────────────┴──────────────────────────────────────────────┘
```

### Levels
| Level | Component | What it shows |
|---|---|---|
| **L1 Datapath** | `DatapathView.tsx` | The single-cycle core drawn as an SVG datapath: PC → IMEM → decoder → regfile → ALU → DMEM → WB mux. Active wires light up with the values on them. |
| **L2 Pipeline** | `PipelineView.tsx` + `PipelineChart.tsx` | The 5 stages as boxes holding the instruction in each, pipeline registers between them, and forwarding arrows when `fwdA/B` are active. Below that, the classic **cycle × instruction chart** (rows = instructions, columns = cycles, cells = IF/ID/EX/MEM/WB, stalls shown as bubbles, flushes crossed out). |
| **L3 Hazard Lab** | `HazardLab.tsx` | Preset snippets (RAW, load-use, branch taken/not taken, store-after-load). Runs the same snippet with forwarding on and off **side by side** (two sim instances) and shows the cycle difference with an explanation of why. |
| **L4 Programs** | `ProgramsView.tsx` | Runs whole programs (fib, bubble sort with a live memory heatmap, memcpy, ASCII Mandelbrot on the console, primes) and compares SINGLE vs PIPE: cycles, CPI, and, using the FPGA fmax from Phase 9, estimated time to finish. |

### Other components
`AsmEditor.tsx` (CodeMirror 6 with an RV32I language mode, error gutter, PC highlight),
`RegisterFile.tsx`, `MemoryView.tsx` (hex + heatmap), `ConsolePanel.tsx`, `StatsBar.tsx`,
`Controls.tsx` (adapted from tiny-tpu), `LevelTabs.tsx` (reused).

### Web tests (Vitest)
- `assembler.test.ts`: golden encodings for every instruction and pseudo-op; label and
  forward-reference resolution; error messages with line numbers.
- `disassembler.test.ts`: assemble → disassemble round trip over the whole ISA.
- `state-schema.test.ts`: a recorded `CycleState[]` fixture from the harness validates against
  the TS types (zod).
- A Playwright smoke test: load `/app`, run fib, and assert the console shows `6765`.

---

## 9. Phases, deliverables and exit criteria

Estimates assume one person working part-time, roughly at the pace of tiny-tpu.

### Phase 0: Scaffold (½ week)
- Create the repo with the §3 layout. Copy `.editorconfig`, the CI skeletons and the web config
  from tiny-tpu. Write `CLAUDE.md`, `AGENTS.md` and `CONTEXT.md`.
- `rtl/spike/counter.sv` → `wasm/spike` builds and runs in the browser (proves the toolchain).
- **Exit:** all three workflows are green on an empty project; the spike page counts in the browser.

### Phase 1: Golden model + toolchain (1 week)
- `sim/golden/iss.py`: full RV32I, the §2.1 memory map, MMIO, and RVFI-style trace output.
- `sw/link.ld`, `crt0.S`, `sw/Makefile`; riscv-tests submodule with the `env/tinycpu` port.
- **The ISS must pass every `rv32ui-p-*` test itself** before any RTL exists.
- Generate `web/src/lib/isa.ts` from `decode.py`, so Python and TS share one opcode table.
- **Exit:** `pytest sim/golden -q` is green; the ISS passes riscv-tests; `sim/programs/*.S` print
  the expected console output under the ISS.

### Phase 2: Building blocks + single-cycle core (1.5 weeks)
- `tiny_cpu_pkg`, `alu`, `regfile`, `imm_gen`, `decoder`, `branch_unit`, `lsu`, `mem_comb`,
  `mmio`, `csr_counters` → `core_single` → `tiny_cpu_top` (CORE="SINGLE").
- A unit test for every module (§5 layer 1).
- **Exit:** `verilator --lint-only -Wall` is clean; all unit tests pass; `core_single` passes
  lockstep on every program and **all included riscv-tests**.

### Phase 3: Pipelined core without hazard handling (1 week)
- `mem_sync`, `core_pipe` with IF/ID/EX/MEM/WB registers (packed structs), `dbg_*` ports per stage.
- Hazards are handled by hand-inserted NOPs only. A `hazard_free/*.S` set proves the datapath works.
- **Exit:** the hazard-free programs pass lockstep; the waveform in GTKWave shows the 5-stage overlap.

### Phase 4: Hazards (1.5 weeks)
- `forward_unit`, `hazard_unit` (load-use stall, branch flush), `cfg_forward_en`.
- Directed tests with **exact cycle counts** (§5) and pinned `perf_baseline.json`.
- **Exit:** `core_pipe` passes all included riscv-tests and 200 random lockstep seeds with
  forwarding both on and off; the hazard cycle counts are pinned.

### Phase 5: WASM harness (1 week)
- `harness.cpp` (dual-model), `bindings.cpp`, `build.sh`, `docs/STATE_SCHEMA.md`.
- A Node test script (`wasm/test.mjs`) that loads the `.mjs`, runs fib on both cores, and checks
  the console output and cycle count against `perf_baseline.json`. **The WASM gets the same
  check as the RTL.**
- **Exit:** `wasm.yml` is green; the size budget is met; the Node test passes.

### Phase 6: Assembler + core UI (2 weeks)
- `assembler.ts`, `disassembler.ts` with Vitest suites and the CI comparison against GNU as.
- `useTinyCpu` (lifecycle, history ring, replay-rewind), `Controls`, `AsmEditor`,
  `RegisterFile`, `MemoryView`, `ConsolePanel`, `StatsBar`.
- **L2 Pipeline view comes first.** It's the signature visual.
- **Exit:** you can type a program, assemble it, step it forward and backward, and watch the
  pipeline view and registers update. The Playwright smoke test passes.

### Phase 7: Remaining levels (1.5 weeks)
- L1 Datapath (SVG), L3 Hazard Lab (two sim instances side by side), L4 Programs (heatmap,
  SINGLE vs PIPE comparison).
- **Exit:** every level works on desktop and at phone width (375 px), in light and dark themes.

### Phase 8: Docs, landing page, launch (1 week)
- Landing page + hero GIF/MP4 (reuse tiny-tpu's capture approach and `gen-og-image.mjs`).
- The five docs pages, each with an embedded live mini-visualizer (as tiny-tpu's `LandingEmbed`).
- README in tiny-tpu's style: badges, live demo link, the verification table (riscv-tests
  N/N passing, random seeds, the size budget).
- Deploy to Vercel (`tiny-cpu.vercel.app`).
- **Exit:** public URL live; README complete; all CI green.

### Phase 9: FPGA synthesis (½–1 week, can run in parallel with Phases 6–8)
- `fpga/ice40` (e.g. iCEBreaker) and/or `fpga/ecp5` (ULX3S): a top wrapper with a UART
  replacing `CONSOLE` and LEDs showing `TOHOST`.
- `fpga.yml` runs Yosys + nextpnr and posts the LUT/FF/BRAM count and fmax to the job summary.
  These numbers feed L4's "estimated real time".
- **Exit:** synthesis is clean with no latches; the numbers are in the README. If you have a board,
  fib prints over UART.

**Total: roughly 12–14 weeks part-time.** Phases 0–5 (about 7 weeks) give you a fully verified
CPU that is already worth publishing on its own.

---

## 10. CI matrix

| Workflow | Trigger | Jobs |
|---|---|---|
| `rtl.yml` | push/PR touching `rtl/ sim/ sw/` | lint → ISS tests → unit tests → riscv-tests (both cores) → lockstep programs → random (200 seeds × fwd on/off) → perf baseline |
| `rtl-nightly.yml` | cron | random 5000 seeds; uploads the failing seed + FST waveform as an artifact |
| `wasm.yml` | push touching `rtl/ wasm/` | build → size budget → `wasm/test.mjs` |
| `web.yml` | push touching `web/` | lint → typecheck → vitest → assembler-vs-GNU → build → Playwright smoke |
| `fpga.yml` | push touching `rtl/ fpga/` | yosys + nextpnr → job summary |

**Full pre-PR check** (goes in `CLAUDE.md`):
```bash
verilator --lint-only -Wall rtl/*.sv
pytest sim/golden -q
cd sim && make unit && make riscv-tests && make lockstep && make random SEEDS=50
bash wasm/build.sh && node wasm/test.mjs
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| riscv-tests assume `0x8000_0000` and their own env | Custom `env/tinycpu/riscv_test.h` + `link.ld`; the ISS proves the port in Phase 1, before any RTL |
| Off-by-one timing from synchronous memories | Write the timing diagram in `ARCHITECTURE.md` **before** coding Phase 3; dedicated directed tests for IF after a redirect and for loads in MEM |
| Forwarding bugs that only show in rare sequences | Random generator weighted toward hazards + lockstep stops at the first divergence with a readable diff |
| Two Verilated models in one WASM collide on symbols | Separate `--prefix Vcpu_pipe` / `Vcpu_single` and separate obj dirs; verify in the Phase 0 spike |
| Long programs → millions of `CycleState` objects | `runFast` for cycles you don't render; 4096-entry ring buffer; replay to rewind |
| TS assembler disagrees with GNU | Byte-exact comparison in CI over the whole program corpus |
| Scope creep (caches, predictor, M) | All in §12; nothing from it starts before Phase 8 ships |

---

## 12. Stretch goals (after v1 ships)

1. **M extension** (`mul/div/rem`): a multi-cycle divider shows a new kind of stall in the UI.
   Add the `rv32um-p-*` tests.
2. **Branch prediction**: static BTFN, then a 2-bit BHT + BTB. L3 gets a predictor-accuracy panel.
3. **Instruction/data cache**: a direct-mapped I$ and D$ with a slow backing memory. A new
   "L5 Memory" view shows hits and misses (and sets up a future *tiny-cache* project).
4. **Traps + Zicsr** (`mtvec`, `mepc`, `mcause`, timer interrupt): enough to run a tiny scheduler.
5. **C compiler in CI**: build C programs with gcc and ship them as presets (precompiled `.hex`).
6. **Tiny Tapeout** submission of the single-cycle core.
7. **tiny-soc**: put tiny-cpu, tiny-tpu and a ported tiny-gpu on one bus, with the CPU sending
   matmul work to the TPU through MMIO.

---

## 13. First week, concretely

1. Create `deaneeth/tiny-cpu`; copy tiny-tpu's `.editorconfig`, `web/` config and the three
   workflow skeletons; write `CLAUDE.md`/`CONTEXT.md` with §2's decisions table.
2. Port the spike (`counter.sv` → WASM → page) and get CI green.
3. Write `iss.py` + `test_iss.py` (start with ADDI/ADD/LUI/JAL/BEQ/LW/SW and grow from there).
4. Add the riscv-tests submodule + `env/tinycpu`; get `rv32ui-p-add` passing on the ISS.
5. Write `docs/ARCHITECTURE.md` with the pipeline timing diagram for synchronous IMEM/DMEM.
