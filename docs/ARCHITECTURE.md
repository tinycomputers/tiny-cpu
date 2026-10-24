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

## Verification (Phase 2)

| Layer | Where | What |
|---|---|---|
| Unit | `sim/test_*.py` | Every block vs the golden model / independent tables; decoder legality vs the ISS on 4000+ words and every single-bit mutation of each opcode |
| Constants | `sim/golden/test_consts.py` | `sim/consts.py` == `rtl/tiny_cpu_pkg.sv` == `golden/iss.py` |
| Lockstep | `sim/test_core_lockstep.py` | 45 images (40 riscv-tests + 5 programs) retire-for-retire against the ISS; 13 fault cases; halt/frozen-core checks; CPI = 1 |
| Lint | `scripts/lint.sh` | `-Wall` clean for every module standalone and the whole design |

Run: `bash scripts/lint.sh && bash sim/run.sh all` (after `make -C sw all`).
