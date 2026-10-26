"""Shared lockstep machinery: RTL (tiny_cpu_top) vs the golden ISS, one retire at a time.

The ISS steps once per rvfi_valid pulse and every retire field must match; the first divergence stops
the run with the ISS's last retired instructions. Also checked: faults (ISS raises <=> RTL sets
`fault`, with no retire), a frozen core after halt/fault, MMIO side effects, final registers, and the
cycle count for the core under test (TINYCPU_CORE = SINGLE | PIPE).
"""

import json
import os
from pathlib import Path

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, ReadOnly, RisingEdge, Timer

from golden.pipemodel import pipe_cycles
from golden.decode import encode as e  # noqa: F401  (re-exported for tests)
from golden.iss import IMEM_SIZE, DMEM_SIZE, Iss, IssError

CORE = os.environ.get("TINYCPU_CORE", "SINGLE")

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "sw" / "build"
EXPECTED = json.loads((ROOT / "sim" / "programs" / "expected.json").read_text())
MAX_CYCLES = 200_000

FIELDS = [  # (RTL signal, ISS Retire attribute, cycle-dependent?)
    ("rvfi_order", "order", False), ("rvfi_pc", "pc", False), ("rvfi_insn", "insn", False),
    ("rvfi_rd_addr", "rd_addr", False), ("rvfi_rd_wdata", "rd_wdata", True),
    ("rvfi_pc_wdata", "pc_wdata", False), ("rvfi_mem_addr", "mem_addr", False),
    ("rvfi_mem_rmask", "mem_rmask", False), ("rvfi_mem_wmask", "mem_wmask", False),
    ("rvfi_mem_rdata", "mem_rdata", True), ("rvfi_mem_wdata", "mem_wdata", False),
    ("rvfi_misaligned", "misaligned", False), ("rvfi_halt", "halt", False),
]


def images():
    out = []
    for group in ("riscv-tests", "programs"):
        out += sorted(p.name.removesuffix(".imem.bin") for p in (BUILD / group).glob("*.imem.bin"))
    return out


def stem_path(name):
    group = "riscv-tests" if name.startswith("rv32ui") else "programs"
    return BUILD / group / name


def words(data: bytes, count: int) -> list[int]:
    data = bytes(data).ljust(count * 4, b"\0")
    return [int.from_bytes(data[4 * i : 4 * i + 4], "little") for i in range(count)]


def prog_bytes(*ws) -> bytes:
    return b"".join((w & 0xFFFFFFFF).to_bytes(4, "little") for w in ws)


_clock = None


def ensure_clock(dut):
    """One clock driver per test (a test may call lockstep() many times; finished tasks are dead)."""
    global _clock
    if _clock is None or _clock.done():
        _clock = cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())


async def reset_and_load(dut, imem: bytes, dmem: bytes, forward: int = 1):
    ensure_clock(dut)
    await Timer(1, "ns")  # a previous lockstep() ends in the ReadOnly phase, where writes are illegal
    dut.rst_n.value, dut.load_en.value = 0, 0
    dut.cfg_forward_en.value = forward
    dut.load_sel.value, dut.load_addr.value, dut.load_data.value = 0, 0, 0
    await FallingEdge(dut.clk)
    for sel, data, count in ((0, imem, IMEM_SIZE // 4), (1, dmem, DMEM_SIZE // 4)):
        for i, w in enumerate(words(data, count)):  # whole memory: wipes the previous program
            dut.load_en.value, dut.load_sel.value, dut.load_addr.value, dut.load_data.value = 1, sel, i, w
            await FallingEdge(dut.clk)
    dut.load_en.value = 0
    await FallingEdge(dut.clk)
    dut.rst_n.value = 1  # first rising edge after this executes the instruction at pc 0


def expected_cycles(instret: int, history, forward: bool = True) -> int:
    """Cycles from reset release until the halting retire is visible.
    SINGLE: one per instruction. PIPE: the independent timing model (golden/pipemodel.py)."""
    if CORE == "SINGLE":
        return instret
    return pipe_cycles(history, forward)


def explain(history, msg):
    tail = "\n".join(f"    {r}" for r in history[-8:])
    return f"{msg}\n  last ISS retires:\n{tail}"


async def lockstep(dut, imem: bytes, dmem: bytes = b"", expect_fault: bool | None = None, forward: int = 1):
    """Run RTL and ISS together to halt (or fault). Returns (iss, rtl_console, cycles)."""
    await reset_and_load(dut, imem, dmem, forward)
    iss = Iss(imem, dmem)
    history, console, cycles, faulted = [], bytearray(), 0, False

    while True:
        await RisingEdge(dut.clk)
        await ReadOnly()
        cycles += 1
        assert cycles <= MAX_CYCLES, explain(history, f"no halt after {MAX_CYCLES} cycles")
        if int(dut.console_valid.value):
            console.append(int(dut.console_data.value))

        if int(dut.fault.value):  # RTL refused an instruction: the ISS must raise on the same one
            assert not int(dut.rvfi_valid.value), "RTL retired and faulted in the same cycle"
            try:
                iss.step()
            except IssError:
                faulted = True
                break
            raise AssertionError(explain(history, f"RTL faulted at pc={int(dut.dbg_pc.value):#x}, ISS executed it"))

        if int(dut.rvfi_valid.value):
            try:
                exp = iss.step()
            except IssError as exc:
                raise AssertionError(explain(history, f"RTL retired pc={int(dut.rvfi_pc.value):#x} but ISS raised: {exc}"))
            for sig, attr, cyc_dep in FIELDS:
                if cyc_dep and exp.cycle_dependent:
                    continue
                got, want = int(getattr(dut, sig).value), int(getattr(exp, attr))
                assert got == want, explain(
                    history + [exp], f"retire #{exp.order} {attr}: RTL={got:#x} ISS={want:#x}\n  at {exp}")
            assert int(dut.rvfi_cycle_dep.value) == int(exp.cycle_dependent), explain(history + [exp], "cycle_dep flag")
            history.append(exp)
            if exp.halt:
                break
        else:
            assert not iss.halted, "ISS halted but RTL never reported the halting retire"

    if expect_fault is not None:
        assert faulted == expect_fault, f"expected fault={expect_fault}, got {faulted}"

    # after a halt/fault the core must be frozen
    pc, regs = int(dut.dbg_pc.value), int(dut.dbg_regs.value)
    for _ in range(4):
        await RisingEdge(dut.clk)
        await ReadOnly()
        assert not int(dut.rvfi_valid.value) and not int(dut.console_valid.value)
        assert int(dut.dbg_pc.value) == pc and int(dut.dbg_regs.value) == regs, "core moved after halt"
    assert int(dut.halted.value) == int(not faulted) and int(dut.fault.value) == int(faulted)

    # architectural state matches
    # Registers last written by a cycle-dependent instruction (rdcycle, rdtime, CYCLE MMIO) hold timing
    # values the ISS cannot know; they are masked in the per-retire compare and here.
    timing = set()
    for r in history:
        if r.rd_addr:
            (timing.add if r.cycle_dependent else timing.discard)(r.rd_addr)
    got_regs = int(dut.dbg_regs.value)
    got = [(got_regs >> (32 * i)) & 0xFFFFFFFF for i in range(32)]
    diff = [i for i in range(32) if got[i] != iss.regs[i] and i not in timing]
    assert not diff, "register file differs: " + ", ".join(
        f"x{i} RTL={got[i]:#x} ISS={iss.regs[i]:#x}" for i in diff)
    assert bytes(console) == bytes(iss.console), f"console: RTL={bytes(console)!r} ISS={bytes(iss.console)!r}"
    if not faulted:
        assert bool(int(dut.tohost_valid.value)) == (iss.tohost is not None)
        if iss.tohost is not None:
            assert int(dut.tohost_data.value) == iss.tohost
        assert int(dut.dbg_pc.value) == iss.pc
        assert iss.instret == int(dut.dbg_instret.value), (
            f"instret: ISS={iss.instret} RTL={int(dut.dbg_instret.value)}")
        want = expected_cycles(iss.instret, history, bool(forward))
        assert cycles == want, (
            f"{CORE} forward={forward} cycle count: RTL={cycles} model={want} (instret={iss.instret})")
    return iss, bytes(console), cycles


