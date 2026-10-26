"""5-stage core (CORE="PIPE") vs the golden ISS in lockstep, with forwarding ON and OFF.

Everything runs in both modes (the cfg_forward_en pin is runtime): hazard-free programs, the official
riscv-tests images (back-to-back dependencies, load-use, store->load), the example programs, and
hazard-dense random programs. Cycle counts must equal the independent model golden/pipemodel.py.
Run with TINYCPU_CORE=PIPE and -GCORE="PIPE" (sim/run.sh pipe). RANDOM_SEEDS=N scales the random sweep.
"""

import os

import cocotb
from cocotb.triggers import ReadOnly, RisingEdge

from golden.hazard_free import PROGRAMS, random_program
from golden.hazard_random import random_hazard_program
from golden.progbuild import Prog
from lockstep_lib import CORE, EXPECTED, IMEM_SIZE, e, images, lockstep, prog_bytes, reset_and_load, stem_path
from pathlib import Path

SEEDS = int(os.environ.get("RANDOM_SEEDS", "200"))
MODES = [1, 0]  # cfg_forward_en

assert CORE == "PIPE", "run through `bash sim/run.sh pipe` (sets TINYCPU_CORE=PIPE and -GCORE=\"PIPE\")"


@cocotb.parametrize(name=sorted(PROGRAMS), forward=MODES)
async def test_hazard_free_program(dut, name, forward):
    imem, dmem = PROGRAMS[name]().build()
    iss, console, _ = await lockstep(dut, imem, dmem, expect_fault=False, forward=forward)
    assert iss.passed
    if name == "console_and_csr":
        assert console == b"Hi, pipe!\n!"


@cocotb.parametrize(seed=list(range(60)), forward=MODES)
async def test_random_hazard_free(dut, seed, forward):
    imem, dmem = random_program(seed).build()
    iss, _, _ = await lockstep(dut, imem, dmem, expect_fault=False, forward=forward)
    assert iss.passed


@cocotb.parametrize(seed=list(range(SEEDS)), forward=MODES)
async def test_random_hazard_dense(dut, seed, forward):
    """Dense code over 5 registers: RAW at every distance, load-use, store->load, jumps, CSR reads."""
    imem, dmem = random_hazard_program(seed).build()
    iss, _, _ = await lockstep(dut, imem, dmem, expect_fault=False, forward=forward)
    assert iss.passed


# --------------------------------------------------------------------------- official tests + programs
NAMES = images()
if NAMES:

    @cocotb.parametrize(name=NAMES, forward=MODES)
    async def test_image(dut, name, forward):
        """rv32ui-p-* and sim/programs/*.S, unmodified: only possible now that hazards are handled."""
        stem = stem_path(name)
        imem, dmem = Path(str(stem) + ".imem.bin").read_bytes(), Path(str(stem) + ".dmem.bin").read_bytes()
        iss, console, _ = await lockstep(dut, imem, dmem, expect_fault=False, forward=forward)
        assert iss.passed, f"{name}: failed test case #{(iss.tohost or 0) >> 1}"
        if not name.startswith("rv32ui"):
            assert console.decode() == EXPECTED[name]["console"]
            assert iss.instret == EXPECTED[name]["instret"]


# --------------------------------------------------------------------------- halt and faults
@cocotb.test()
async def ecall_ebreak_halt(dut):
    for insn in (e("ecall"), e("ebreak")):
        p = Prog().addi(1, 0, 7)
        p.raw(insn).addi(1, 0, 9)
        for forward in MODES:
            iss, _, _ = await lockstep(dut, p.build()[0], expect_fault=False, forward=forward)
            assert iss.regs[1] == 7 and iss.tohost is None


def fault_cases():
    def build(*items, tail=()):
        p = Prog()
        for it in items:
            it(p)
        return p.build()[0]

    return {
        "illegal instruction": build(lambda p: p.addi(1, 0, 5), lambda p: p.raw(0x00000000)),
        "csrrs with rs1 != x0": build(lambda p: p.raw(e("csrrs", 1, 1, csr=0xC00))),
        "unknown csr": build(lambda p: p.raw(e("csrrs", 1, 0, csr=0x300))),
        "load from IMEM": build(lambda p: p.lw(1, 0, 0)),
        "store to IMEM": build(lambda p: p.sw(0, 0, 0)),
        "unmapped load": build(lambda p: p.lui(1, 0x80000), lambda p: p.lw(2, 1, 0)),
        "tohost byte store": build(lambda p: p.lui(1, 0x20), lambda p: p.sb(0, 1, 4)),
        "store to CYCLE": build(lambda p: p.lui(1, 0x20), lambda p: p.sw(0, 1, 8)),
        "misaligned jal": build(lambda p: p.raw(e("jal", 0, imm=6))),
        "misaligned taken branch": build(lambda p: p.raw(e("beq", 0, 0, 0, imm=2))),
        "jalr to odd word": build(lambda p: p.addi(1, 0, 6), lambda p: p.jalr(0, 1, 0)),
        "jump past end of IMEM": build(lambda p: p.lui(1, 1), lambda p: p.jalr(0, 1, 0)),
        "fall off end of IMEM": prog_bytes(e("jal", 0, imm=IMEM_SIZE - 4)),
    }


@cocotb.test()
async def faults_stop_the_core_without_retiring(dut):
    for forward in MODES:
        for label, imem in fault_cases().items():
            try:
                await lockstep(dut, imem, expect_fault=True, forward=forward)
            except AssertionError as exc:
                raise AssertionError(f"[{label}, forward={forward}] {exc}") from exc


def setup_console(p):
    """x1 = CONSOLE, x2 = 'A', x3 = 'B', then 3 NOPs so the following dense code has no hazards."""
    p.li(1, 0x20000)
    p.li(2, ord("A"))
    p.li(3, ord("B"))
    p.nop(3)


@cocotb.test()
async def younger_instructions_have_no_effect_after_a_fault(dut):
    """Dense (pad=0) code: 'A' prints, the faulting instruction stops the core, and the stores right
    behind it (already in EX/MEM when it faults) must NOT print."""
    for label, faulting in {
        "illegal": lambda p: p.raw(0x00000000),
        "bus fault": lambda p: p.lw(9, 0, 0),
        "misaligned jal": lambda p: p.raw(e("jal", 0, imm=6)),
    }.items():
        p = Prog(pad=0)
        setup_console(p)
        p.sb(2, 1, 0)
        faulting(p)
        p.sb(3, 1, 0).sb(3, 1, 0).sb(3, 1, 0).nop(3)
        p.exit()
        for forward in MODES:
            try:
                iss, console, _ = await lockstep(dut, p.build()[0], expect_fault=True, forward=forward)
            except AssertionError as exc:
                raise AssertionError(f"[{label}, forward={forward}] {exc}") from exc
            assert console == b"A", f"[{label}, forward={forward}] younger stores leaked: {console!r}"


@cocotb.test()
async def younger_instructions_have_no_effect_after_halt(dut):
    for label, halting in {
        "tohost store": lambda p: (p.li(5, 0x20004), p.li(6, 1), p.nop(2), p.sw(6, 5, 0)),
        "ecall": lambda p: p.raw(e("ecall")),
    }.items():
        p = Prog(pad=0)
        setup_console(p)
        p.sb(2, 1, 0)
        halting(p)
        p.sb(3, 1, 0).sb(3, 1, 0).sb(3, 1, 0)
        for forward in MODES:
            iss, console, _ = await lockstep(dut, p.build()[0], expect_fault=False, forward=forward)
            assert console == b"A", f"[{label}, forward={forward}] instructions after the halt leaked: {console!r}"


# --------------------------------------------------------------------------- pipeline behaviour
async def trace_run(dut, imem, dmem):
    """Run to halt, recording every cycle's stage occupancy (after each clock edge)."""
    await reset_and_load(dut, imem, dmem)
    rows = []
    for _ in range(100_000):
        await RisingEdge(dut.clk)
        await ReadOnly()
        valid = int(dut.dbg_stage_valid.value)
        pcs = int(dut.dbg_stage_pc.value)
        rows.append({"valid": valid, "pc": [(pcs >> (32 * s)) & 0xFFFFFFFF for s in range(5)],
                     "flush": int(dut.dbg_flush_ifid.value), "flush2": int(dut.dbg_flush_idex.value),
                     "retire": int(dut.rvfi_valid.value), "halted": int(dut.halted.value)})
        if rows[-1]["halted"]:
            return rows
    raise AssertionError("no halt")


@cocotb.test()
async def five_instructions_overlap_and_flushes_match_redirects(dut):
    p = Prog(pad=0)
    p.li(1, 3).li(2, 5).nop(3)
    p.add(3, 1, 2).addi(4, 1, 1).sub(5, 2, 1).xor(6, 1, 2).nop(3)
    p.jal(0, "skip").addi(7, 0, 99).addi(7, 0, 98).label("skip").nop(3)
    p.exit()
    imem, dmem = p.build()
    rows = await trace_run(dut, imem, dmem)

    assert any(r["valid"] == 0b11111 and len(set(r["pc"])) == 5 for r in rows), "never had 5 instructions in flight"
    # every flush flag comes with its twin and exactly one jal redirected
    assert all(r["flush"] == r["flush2"] for r in rows)
    assert sum(r["flush"] for r in rows) == 1

    # the classic pipeline diagram, for the log
    first = {}
    lines = ["cycle  IF       ID       EX       MEM      WB"]
    for n, r in enumerate(rows[:24], 1):
        cells = []
        for s in range(5):
            if r["valid"] >> s & 1:
                cells.append(f"{r['pc'][s]:#06x}  ")
            else:
                cells.append("  --    ")
        lines.append(f"{n:5d}  " + " ".join(cells) + ("  <- flush" if r["flush"] else ""))
    dut._log.info("\n" + "\n".join(lines))

    # in-order: a given pc advances one stage per cycle when it is not squashed
    for n in range(len(rows) - 1):
        for s in range(4):
            if rows[n]["valid"] >> s & 1 and rows[n + 1]["valid"] >> (s + 1) & 1 and not rows[n]["flush"]:
                assert rows[n + 1]["pc"][s + 1] == rows[n]["pc"][s], f"cycle {n + 1}: stage {s}->{s + 1} pc mismatch"
