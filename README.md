<div align="center">

# TinyCPU

**A real, synthesizable RV32I RISC-V CPU in SystemVerilog,<br>compiled to WebAssembly and running your assembly live in the browser.**

Third in the series after [tiny-gpu](https://github.com/tinycomputers/tiny-gpu) and [tiny-tpu](https://github.com/tinycomputers/tiny-tpu).

[![RTL CI](https://github.com/tinycomputers/tiny-cpu/actions/workflows/rtl.yml/badge.svg)](https://github.com/tinycomputers/tiny-cpu/actions/workflows/rtl.yml)
[![WASM Build](https://github.com/tinycomputers/tiny-cpu/actions/workflows/wasm.yml/badge.svg)](https://github.com/tinycomputers/tiny-cpu/actions/workflows/wasm.yml)
[![Web CI](https://github.com/tinycomputers/tiny-cpu/actions/workflows/web.yml/badge.svg)](https://github.com/tinycomputers/tiny-cpu/actions/workflows/web.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE)

</div>

> **Live: [tiny-cpu.vercel.app](https://tiny-cpu.vercel.app)**. The app at `/app`, the landing page and the docs are
> deployed. The iCE40 synthesis (Phase 9) builds and runs in simulation; the board itself is not yet tested.
>
> See [`docs/PLAN.md`](docs/PLAN.md) for the full roadmap.

Every pipeline register, forwarding path and stall the UI will draw is a live `dbg_*` signal from the
compiled RTL. Nothing on screen is faked.

```
rtl/*.sv -> Verilator C++ -> Emscripten -> web/public/tiny_cpu.wasm -> React island -> SVG
```

## What it does

- A single-cycle and a 5-stage pipelined RV32I core sharing one decoder, ALU and register file, with forwarding,
  load-use stalls and taken-branch flushes.
- The same hardware in the browser: an assembler (byte-identical to GNU's), an editor, and a viewer that steps through
  every clock edge with the pipeline, the single-cycle datapath, a hazard lab and a programs comparison.
- FPGA synthesis for the iCE40UP5K (iCEBreaker): 14.98 MHz post-route, 93% of the logic cells, no latches. See the FPGA section.

## FPGA

The iCE40UP5K (iCEBreaker) build of the pipelined core, with a UART and LEDs around it, synthesizes cleanly (`bash fpga/ice40/build.sh`):

| Resource | Used | Available |
|---|---|---|
| Logic cells | 4958 | 5280 (93%) |
| Block RAM | 17 | 30 |

The clock reaches 14.98 MHz post-route, above the 12 MHz oscillator, and the netlist has no latches. In simulation the top
level prints `6765` over its UART and reports PASS on the LEDs (`bash sim/run.sh fpga`). The board itself is not yet tested:
the UART and LED pins still need to be placed for the board. Details in [`fpga/README.md`](fpga/README.md).

## Verification

Each check runs in continuous integration on every change.

| What | How much | Against |
|---|---|---|
| Official RISC-V instruction tests (`rv32ui`) | 40 of 42, both cores | Python golden ISS. `fence_i` and `ma_data` are excluded. |
| Hand-written and random programs | 5 and 260 (both forwarding modes) | Golden ISS for results; timing model for pipeline cycles |
| Fault cases | 13 | Golden ISS |
| Mutation checks | 7 (pipeline) and 11 (hazards) | Each one must make a test fail |
| WASM module | 534 checks | Golden fixtures, both cores, forwarding on and off |
| Web app | 72 unit tests, 17 browser tests | Assembler vs GNU bytes; presets on the WASM core |
| Size | About 77 KB gzipped | Build fails above 400 KB |

Details, and what is not verified yet, are on the Verification docs page and in `docs/PLAN.md`.

## Layout

| Path | Contents |
|---|---|
| `rtl/` | SystemVerilog: single-cycle and 5-stage cores + building blocks (`spike/counter.sv` is the Phase 0 toolchain check) |
| `sim/` | golden ISS (`sim/golden/`), cocotb tests, asm programs (`sim/programs/`) |
| `sw/` | linker script, crt0, riscv-tests port + Makefile |
| `wasm/` | Verilator -> Emscripten harness |
| `web/` | Astro + React app: assembler, editor, pipeline view, cycle controls |
| `fpga/` | Yosys/nextpnr flows (Phase 9) |
| `docs/` | plan, architecture, state schema |

## Dev quickstart

```bash
# RTL + cocotb (needs Verilator >= 5.036)
python3 -m venv ~/.venvs/tinycpu && source ~/.venvs/tinycpu/bin/activate
pip install -r sim/requirements.txt
verilator --lint-only -Wall --top-module counter rtl/spike/counter.sv
bash scripts/lint.sh && bash sim/run.sh all     # needs: make -C sw all

# WASM (needs Verilator + Emscripten)
bash wasm/build.sh && node wasm/test.mjs

# Web
cd web && pnpm install && pnpm dev     # then open /app (or `pnpm build && pnpm test:e2e` for the smoke tests)
```

## License

MIT
