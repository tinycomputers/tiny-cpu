# fpga/

Synthesis of TinyCPU for FPGAs. The iCE40 top level (`ice40/fpga_top.sv`) runs the 5-stage pipeline on a program preloaded
into block RAM, prints its console output over a 115200-baud UART, and shows the run on the LEDs.

## iCE40UP5K (iCEBreaker)

```bash
source scripts/env.sh                  # Yosys and nextpnr from .venv (see below)
bash fpga/ice40/build.sh               # synthesis, latch check, place and route, fmax
bash sim/run.sh fpga                   # the same top level in simulation: decodes the UART and checks the LEDs
```

One-time setup, in the project's virtualenv:

```bash
.venv/bin/pip install yowasp-yosys yowasp-nextpnr-ice40
```

The results (post-route, Yosys 0.70, nextpnr 0.11.1):

| Resource | Used | Available |
|---|---|---|
| Logic cells (LUT + FF) | 4958 | 5280 (93%) |
| Block RAM (4 Kbit) | 17 | 30 |
| DSP | 0 | 8 |

- **Clock**: 14.98 MHz post-route, against the 12 MHz oscillator. The check passes with margin.
- **Latches**: none. `build.sh` fails if Yosys finds a latch cell (`select -assert-none`), and `check -assert` runs too.

## How it fits together

- **The program is in block RAM.** The memories take an optional `$readmemh` image (`IMEM_INIT`, `DMEM_INIT` on
  `tiny_cpu_top`). Simulation leaves them empty, so nothing changes there. `gen_image.py` turns a built program
  (`sw/build/programs/<name>.{imem,dmem}.bin`) into the hex files in `images/`. The default image is `fib`, which prints `6765`.
- **Console output**: a 255-byte FIFO takes the core's CONSOLE stores and a UART transmitter sends them. A byte written to a full
  FIFO is dropped and sets the overflow LED.
- **LEDs**: running, done (TOHOST written), pass, fault, overflow.
- **Reset**: a 65,536-clock power-on reset.

## Yosys and the RTL copy

Yosys's SystemVerilog parser is narrower than the simulators'. The RTL uses package imports in module headers, typed string
parameters, and ANSI-style function arguments, which Yosys does not accept. So `prepare_rtl.py` copies the RTL for the
synthesis run and rewrites those constructs. It qualifies each package symbol as `tiny_cpu_pkg::NAME`, and turns the typed
string parameters into untyped ones. The original files are not changed by it, and the simulators read them as before.

Two RTL changes came out of this, and both are verified by the simulation suites:

- The two functions in `forward_unit.sv` and `hazard_unit.sv` use the old-style argument list, and `forward_unit`'s `pick`
  uses a result variable instead of early returns. The logic is the same.
- `mem_sync.sv` moved its read-new bypass out of the memory into a merge after the read register. The value on `rdata` is the
  same at every edge. The memory now has a plain read port, which block RAM inference needs. Without this change the data
  memory was built from flip-flops and the design needed about 72,000 logic cells.

## Not done

- **Board pins**: `icebreaker.pcf` pins only the 12 MHz clock. The UART and the LEDs are placed automatically
  (`--pcf-allow-unconstrained`), so a bitstream would not yet drive the board's UART or LEDs. Pin them for your board before programming it.
- **Bitstream and board test**: the build stops after place and route. The UART behaviour is checked in simulation only.
- **ECP5**: not yet. The plan lists ULX3S as an option; the flow here is iCE40 only.
