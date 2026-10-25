# TinyCPU architecture

Decisions that are fixed live in `CONTEXT.md`; the full roadmap is `docs/PLAN.md`. This file describes
what is actually built.

## Single-cycle core (`rtl/core_single.sv`, Phase 2)

```
          +--------------------------------------------------------------------------+
  pc_q -> | IMEM (comb) -> decoder -> imm_gen                                        |
          |                  |                                                       |
          |   regfile(rs1,rs2) -> ALU (a: rs1|pc, b: rs2|imm) -> LSU -> mmio/DMEM     |
          |         ^                  |  \                          |                |
          |         |                  |   branch_unit              load_value        |
          |         +---- wb mux <-----+--- pc+4 / csr <-------------+                |
          +--------------------------------------------------------------------------+
  next_pc = jalr ? {alu_y[31:1],0} : (jal | taken branch) ? pc+imm : pc+4
```

One instruction retires per clock (CPI = 1), so `cycles == instret`; the lockstep test asserts it.

| Block | File | Notes |
|---|---|---|
| ALU | `alu.sv` | `ALU_COPY_B` implements LUI; shifts use `b[4:0]` |
| Decoder | `decoder.sv` | Legality identical to the ISS; illegal forces every side-effecting control low |
| Immediates | `imm_gen.sv` | I/S/B/U/J selected by the decoder |
| Branches | `branch_unit.sv` | funct3 2 and 3 never take |
| Load/store | `lsu.sv` | Byte lanes, masks, sign/zero extension, forced alignment |
| Address decode + MMIO | `mmio.sv` | DMEM / CONSOLE / TOHOST / CYCLE and the exact fault rules |
| Registers | `regfile.sv` | x0 = 0, reset to 0, `BYPASS` parameter (see below) |
| Counters | `csr_counters.sv` | Zicntr read-only: cycle/time/instret + high halves |
| Memory | `mem_comb.sv` | Combinational read (simulation); `mem_sync.sv` arrives with the pipeline |
| Top | `tiny_cpu_top.sv` | `CORE` parameter, memory loader port, RVFI + debug outputs |

### Contracts

* **Retire record (`rvfi_*`)** is *registered*: after a clock edge it describes the instruction that retired in
  the cycle that just ended; `rvfi_valid` is high for exactly that cycle. Field conventions match
  `sim/golden/iss.py` (word-aligned `mem_addr`, lane-positioned data, `rd_addr = 0` for no write).
* **Faults** (illegal instruction, bus fault, misaligned or out-of-IMEM jump) set `fault`, stop the core, and
  retire nothing - no register, memory or MMIO side effect. The ISS raises on exactly the same instructions.
* **Halt** (`ecall`, `ebreak`, TOHOST word store) retires, then sets `halted`. The core is frozen afterwards.
* **Loader**: with `rst_n` low, pulse `load_en` + `load_sel` (0 IMEM, 1 DMEM) + `load_addr` (word) + `load_data`.

### Decisions and lessons

* **The regfile write-first bypass must be off in the single-cycle core** (`BYPASS = 0`). The pipelined core
  needs it (the writer in WB is a different instruction from the reader in ID), but here the writer *is* the
  reader: `lw x1, 0(x1)` would read its own loaded value as the address, which is both wrong and a real
  combinational loop (Verilator's UNOPTFLAT lint caught it). The pipeline keeps `BYPASS = 1`.
* **`jalr` clears bit 0 of the target.** No official rv32ui test exercises an odd target, so
  `jalr_clears_bit0_of_the_target` in `sim/test_core_lockstep.py` pins it (found by mutation testing).
* `uses_rs1/uses_rs2` are already decoded for the Phase 4 hazard unit; the single-cycle core ignores them.
* `cycle_dependent` retires (`rdcycle`, `rdtime`, the CYCLE MMIO read) are flagged by the RTL and masked by
  the lockstep comparison, because the ISS cannot know pipeline timing.

## 5-stage pipelined core (`rtl/core_pipe.sv`, Phase 3)

```
 pc_q --> IMEM(sync) ==> [IF/ID] --> decode, regfile read ==> [ID/EX] --> ALU, branch ==> [EX/MEM] --> LSU, MMIO ==> [MEM/WB] --> reg write, retire
  ^        addressed        id_pc                                          DMEM addressed here                      store/console/tohost                 CCSR read
  |        by pc_q                                                         (sync read)                              effects happen here
  +--------------------------- redirect (taken branch / jal / jalr) from EX: flush IF/ID + ID/EX ---------------------------+
```

Real output of `sim/test_pipe_lockstep.py::five_instructions_overlap_and_flushes_match_redirects` (each cell is the pc
in that stage after the clock edge; the `jal` at 0x48 is in EX when it flushes):

```
cycle  IF       ID       EX       MEM      WB
   18  0x0048   0x0044   0x0040   0x003c   0x0038      five instructions in flight
   19  0x004c   0x0048   0x0044   0x0040   0x003c
   20  0x0050   0x004c   0x0048   0x0044   0x0040    <- flush (jal 0x48 -> 0x54)
   21  0x0054     --       --     0x0048   0x0044      two bubbles = the 2-cycle penalty
   22  0x0058   0x0054     --       --     0x0048
```

Deviation from the original plan: the taken-branch flush landed in Phase 3, not 4. Without it the NOPs after a taken
branch retire on the wrong path and the lockstep stream can never match the ISS.

### Hazards (Phase 4)

| Producer ahead of the consumer | forwarding **on** | forwarding **off** (`cfg_forward_en = 0`) |
|---|---|---|
| ALU / link, distance 1 | forwarded EX/MEM -> EX, **0 stalls** | 2 stalls |
| ALU / link, distance 2 | forwarded MEM/WB -> EX, **0 stalls** | 1 stall |
| load or CSR read, distance 1 | **1 stall** (load-use), then MEM/WB | 2 stalls |
| load or CSR read, distance 2 | **0 stalls** (MEM/WB) | 1 stall |
| any producer, distance >= 3 | register file write-first bypass, 0 | 0 |
| taken branch / jump | flush IF/ID + ID/EX: **2 cycles** (predict not-taken); a flush hides any stall on the squashed instruction | same |

* `forward_unit` picks `dbg_fwd_a/b` per operand (0 none, 1 EX/MEM, 2 MEM/WB; the nearer producer wins; never x0).
* `hazard_unit` raises `dbg_stall` (hold `pc_q`, the IF/ID register and IMEM's output register via `imem_re = 0`, and put a
  bubble in ID/EX) and `dbg_load_use`. A redirect from EX always wins over a stall.
* **Loads and CSR reads are "late" producers.** Load data exists only after MEM, and a CSR is read in WB, so neither can be
  forwarded from EX/MEM; their consumers wait one cycle and take the value from MEM/WB.
* **With forwarding off the cost is 2, not 3**, because the register file's write-first bypass delivers a value written
  in WB to a reader in ID in the same cycle. (The original plan's "3" assumed no bypass.)
* **Exact timing is specified outside the RTL** by `sim/golden/pipemodel.py`: with `T(i)` the cycle instruction `i` is in
  EX, `T(i) >= T(i-1)+1`, `>= T(branch)+3` after a taken branch, `>= T(p)+2` for a late producer / `+1` otherwise with
  forwarding, `>= T(p)+3` without. The RTL must match it to the cycle on every program (`cycles = T(last) + 2`).
* Pinned numbers: `sim/golden/hazard_cases.py` (paper-derived, checked against the model *and* the RTL, including the debug
  flags) and `sim/perf_baseline.json` (cycles per program, per core and mode; `python -m golden.perf`).

What the baseline shows: on loop-heavy code CPI with forwarding is 1.4-1.65, and almost all of the excess is the 2-cycle
penalty on every taken loop branch (predict-not-taken), not data hazards - the case for a branch predictor (PLAN stretch #2).

### Timing contract
* **Synchronous memories.** `pc_q` is the IMEM address; the BRAM output register *is* the instruction in ID, with `id_pc`
  carried beside it. DMEM is addressed in EX, so load data is back in MEM, where the LSU extracts and extends it.
  The IF stage therefore has no instruction word to show (`dbg_stage_insn[IF] = 0`; look it up from the pc).
* **Write-first DMEM** (`mem_sync` `READ_NEW=1`). A load reads DMEM in EX at the same clock edge at which the store
  ahead of it writes in MEM; without write-first the load returns stale data. This is the memory twin of a forwarding
  path, and `mem_raw_adjacent` pins it (the only test that fails when it is removed).
* **Cycle count.** First retire is visible after 5 edges, then one per cycle: `cycles = instret + 4 + 2 * redirects`.
  The lockstep test asserts this exactly, and the flush flag fires once per redirect.
* **CSR read in WB.** `instret` seen by an instruction equals the number retired before it, as in the ISS.
  `dbg_pc` is the *architectural* pc (next instruction to retire), not the fetch pc.

### Precise faults and halt
A faulting or halting instruction travels to WB like any other. While it sits there (`older_stop`) younger
instructions in MEM are gated from writing DMEM, CONSOLE or TOHOST; once it leaves, `active` freezes the core.
Faulting instructions never retire; nothing younger ever retires. `younger_instructions_have_no_effect_after_*`
runs dense code with stores directly behind the faulting/halting instruction and checks that nothing leaks.

### Lessons
* `lockstep` must mask registers last written by timing-dependent reads (rdcycle, CYCLE MMIO) in the *final*
  register compare as well as per-retire; the single-cycle core hid this because there cycle == instret.
* A taken jump flushes its own padding NOPs, so the instruction at a jump *target* is only 1 instruction behind the
  jump's link register. `Prog` pads after instructions, not at labels: the dynamic `raw_hazards()` check found this.

## Verification (Phase 2 and 3)

| Layer | Where | What |
|---|---|---|
| Unit | `sim/test_*.py` | Every block vs the golden model / independent tables; decoder legality vs the ISS on 4000+ words and every single-bit mutation of each opcode |
| Constants | `sim/golden/test_consts.py` | `sim/consts.py` == `rtl/tiny_cpu_pkg.sv` == `golden/iss.py` |
| Lockstep | `sim/test_core_lockstep.py` | 45 images (40 riscv-tests + 5 programs) retire-for-retire against the ISS; 13 fault cases; halt/frozen-core checks; CPI = 1 |
| Lint | `scripts/lint.sh` | `-Wall` clean for every module standalone and the whole design |

| Pipeline lockstep | `sim/test_pipe_lockstep.py` | In **both forwarding modes**: the 40 riscv-tests + 5 programs, 9 hazard-free programs, 60 hazard-free and 200 hazard-dense random programs (`RANDOM_SEEDS=N` scales it; nightly runs 5000) retire-for-retire vs the ISS; 13 fault cases; younger-instruction gating after fault/halt; cycle count == the independent model; 5-deep overlap |
| Hazard patterns | `sim/test_pipe_hazards.py` | 17 paper-derived patterns x 2 modes: pinned extra cycles, `dbg_stall` count == model, one `dbg_load_use` pulse where expected, forwarding source observed |
| Hazard units | `sim/test_forward_unit.py`, `test_hazard_unit.py` | Exhaustive over (control bits x small register space): 5184 and 20736 combinations |
| Timing model | `sim/golden/test_pipemodel.py` | Paper-derived cases + random-program sanity, no RTL |
| Program builder | `sim/golden/progbuild.py`, `hazard_free.py` | `Prog(pad=N)` mini-assembler; `raw_hazards()` proves a program hazard-free from its dynamic ISS trace (no toolchain needed) |

Run: `bash scripts/lint.sh && bash sim/run.sh all` (after `make -C sw all`). `all` = unit + lockstep (single-cycle) + pipe.


## WASM harness (Phase 5)

`wasm/harness.cpp` Verilates `tiny_cpu_top` twice - `CORE="SINGLE"` and `CORE="PIPE"` - with distinct `--prefix`, and links
both into one module. `TinyCpuSim` owns both models and `reset(core)` selects one; program memory is written to both, and
both are held in reset while loading, so the inactive core is never clocked by accident.

Every value comes from an output port of the Verilated model. The one exception is data memory, which the RTL does not
expose: the harness keeps a shadow copy fed from the retire records (`rvfi_mem_*`). The JavaScript contract is
`docs/STATE_SCHEMA.md`.

Verification (`node wasm/test.mjs`, 534 checks): each fixture in `wasm/test/fixtures.json` runs on SINGLE and on PIPE with
forwarding on and off. It checks console output, final registers (timing-dependent ones excluded), data memory, instruction
count, the SHA-256 of the retire stream against the Python ISS, the halt/tohost behaviour, and the cycle count against the
pipeline model. Four mutations were caught: a forwarding pin ignored, a console byte dropped, a cycle counter off by one, and
the shadow memory's byte order reversed.

Size: 194 KB raw, 77 KB gzipped (budget 400 KB), enforced by `build.sh`.
