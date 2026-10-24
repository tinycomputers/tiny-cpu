"""RTL vs golden ISS, one retire at a time.

Every program in sw/build/{riscv-tests,programs} is loaded into tiny_cpu_top. The ISS steps once for
each rvfi_valid pulse and all retire fields must match; the first divergence stops the run with the
last retired instructions of the ISS. Also checked: faults (ISS raises <=> RTL sets `fault`, with no
retire), halt behaviour, MMIO side effects, and CPI == 1 for the single-cycle core.

Build the images first: make -C sw all.   REQUIRE_RISCV_TESTS=1 turns a missing build into a failure.
"""

import json
import os
from pathlib import Path

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, ReadOnly, RisingEdge, Timer

from golden.decode import encode as e
from golden.iss import IMEM_SIZE, DMEM_SIZE, Iss, IssError

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


async def reset_and_load(dut, imem: bytes, dmem: bytes):
    ensure_clock(dut)
    await Timer(1, "ns")  # a previous lockstep() ends in the ReadOnly phase, where writes are illegal
    dut.rst_n.value, dut.load_en.value = 0, 0
    dut.load_sel.value, dut.load_addr.value, dut.load_data.value = 0, 0, 0
    await FallingEdge(dut.clk)
    for sel, data, count in ((0, imem, IMEM_SIZE // 4), (1, dmem, DMEM_SIZE // 4)):
        for i, w in enumerate(words(data, count)):  # whole memory: wipes the previous program
            dut.load_en.value, dut.load_sel.value, dut.load_addr.value, dut.load_data.value = 1, sel, i, w
            await FallingEdge(dut.clk)
    dut.load_en.value = 0
    await FallingEdge(dut.clk)
    dut.rst_n.value = 1  # first rising edge after this executes the instruction at pc 0


def explain(history, msg):
    tail = "\n".join(f"    {r}" for r in history[-8:])
    return f"{msg}\n  last ISS retires:\n{tail}"


async def lockstep(dut, imem: bytes, dmem: bytes = b"", expect_fault: bool | None = None):
    """Run RTL and ISS together to halt (or fault). Returns (iss, rtl_console, cycles)."""
    await reset_and_load(dut, imem, dmem)
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
    got_regs = int(dut.dbg_regs.value)
    assert [(got_regs >> (32 * i)) & 0xFFFFFFFF for i in range(32)] == iss.regs, "register file differs"
    assert bytes(console) == bytes(iss.console), f"console: RTL={bytes(console)!r} ISS={bytes(iss.console)!r}"
    if not faulted:
        assert bool(int(dut.tohost_valid.value)) == (iss.tohost is not None)
        if iss.tohost is not None:
            assert int(dut.tohost_data.value) == iss.tohost
        assert int(dut.dbg_pc.value) == iss.pc
        # single-cycle core: one instruction per clock, from reset release to the halting retire
        assert cycles == iss.instret == int(dut.dbg_instret.value), (
            f"CPI != 1: cycles={cycles} instret={iss.instret} rtl_instret={int(dut.dbg_instret.value)}")
    return iss, bytes(console), cycles


# --------------------------------------------------------------------------- images
@cocotb.test()
async def images_present(dut):
    if not images():
        msg = "no images in sw/build (run `make -C sw all`)"
        assert os.environ.get("REQUIRE_RISCV_TESTS") != "1", msg
        dut._log.warning(msg)


NAMES = images()
if NAMES:

    @cocotb.parametrize(name=NAMES)
    async def test_image(dut, name):
        stem = stem_path(name)
        imem, dmem = (Path(str(stem) + ".imem.bin").read_bytes(), Path(str(stem) + ".dmem.bin").read_bytes())
        iss, console, _ = await lockstep(dut, imem, dmem, expect_fault=False)
        if name.startswith("rv32ui"):
            assert iss.passed, f"{name}: failed test case #{(iss.tohost or 0) >> 1}"
        else:
            assert iss.passed
            assert console.decode() == EXPECTED[name]["console"]
            assert iss.instret == EXPECTED[name]["instret"]


# --------------------------------------------------------------------------- directed
TOHOST_HI = 0x20000


@cocotb.test()
async def ecall_and_ebreak_halt_after_retiring(dut):
    for halt_insn in (e("ecall"), e("ebreak")):
        iss, _, cycles = await lockstep(dut, prog_bytes(e("addi", 1, 0, imm=7), halt_insn, e("addi", 1, 0, imm=9)),
                                        expect_fault=False)
        assert cycles == 2 and iss.regs[1] == 7 and iss.tohost is None


@cocotb.test()
async def x0_writes_and_self_dependent_instructions(dut):
    """lw x1,0(x1)-style hazards that only exist in a single-cycle core with a (wrong) bypass."""
    prog = [e("lui", 1, imm=0x10000), e("addi", 2, 0, imm=0x55), e("sw", 0, 1, 2, imm=0),
            e("addi", 1, 1, imm=0), e("lw", 1, 1, imm=0),          # x1 = mem[x1] using the OLD x1
            e("addi", 0, 1, imm=5), e("add", 3, 0, 1), e("jalr", 1, 1, imm=0)]
    prog[-1] = e("addi", 4, 1, imm=1)
    await lockstep(dut, prog_bytes(*prog, e("ecall")), expect_fault=False)


@cocotb.test()
async def faults_stop_the_core_without_retiring(dut):
    cases = {
        "illegal instruction": [e("addi", 1, 0, imm=5), 0x00000000],
        "csrrs with rs1 != x0": [e("csrrs", 1, 1, csr=0xC00)],
        "unknown csr": [e("csrrs", 1, 0, csr=0x300)],
        "load from IMEM": [e("lw", 1, 0, imm=0)],
        "store to IMEM": [e("sw", 0, 0, 0, imm=0)],
        "unmapped load": [e("lui", 1, imm=0x80000000), e("lw", 2, 1, imm=0)],
        "tohost byte store": [e("lui", 1, imm=0x20000), e("sb", 0, 1, 0, imm=4)],
        "store to CYCLE": [e("lui", 1, imm=0x20000), e("sw", 0, 1, 0, imm=8)],
        "misaligned jal": [e("jal", 0, imm=6)],
        "misaligned taken branch": [e("beq", 0, 0, 0, imm=2)],
        "jalr to odd word": [e("addi", 1, 0, imm=6), e("jalr", 0, 1, imm=0)],
        "jump past end of IMEM": [e("lui", 1, imm=0x1000), e("jalr", 0, 1, imm=0)],
        "fall off end of IMEM": [e("jal", 0, imm=IMEM_SIZE - 4)],
    }
    for label, prog in cases.items():
        try:
            await lockstep(dut, prog_bytes(*prog), expect_fault=True)
        except AssertionError as exc:
            raise AssertionError(f"[{label}] {exc}") from exc


@cocotb.test()
async def untaken_misaligned_branch_is_fine(dut):
    prog = [e("addi", 1, 0, imm=1), e("beq", 0, 1, 0, imm=2), e("addi", 2, 0, imm=2), e("ecall")]
    iss, _, _ = await lockstep(dut, prog_bytes(*prog), expect_fault=False)
    assert iss.regs[2] == 2


@cocotb.test()
async def misaligned_loads_stores_are_forced_into_alignment(dut):
    prog = [e("lui", 1, imm=0x10000), e("lui", 2, imm=0x11223000), e("addi", 2, 2, imm=0x344),
            e("sw", 0, 1, 2, imm=0), e("lw", 3, 1, imm=1), e("lh", 4, 1, imm=3), e("sh", 0, 1, 2, imm=1),
            e("sw", 0, 1, 2, imm=3), e("lw", 5, 1, imm=0), e("ecall")]
    await lockstep(dut, prog_bytes(*prog), expect_fault=False)


@cocotb.test()
async def jalr_clears_bit0_of_the_target(dut):
    """No official rv32ui test jumps to an odd address, so pin it here: (rs1 + imm) & ~1."""
    # odd base register, even offset -> odd sum
    prog = [e("addi", 1, 0, imm=0x11), e("jalr", 2, 1, imm=0), e("addi", 3, 0, imm=99), e("addi", 3, 0, imm=98),
            e("ecall")]
    iss, _, _ = await lockstep(dut, prog_bytes(*prog), expect_fault=False)
    assert iss.regs[2] == 8 and iss.regs[3] == 0  # linked to pc+4, skipped both addi
    # even base, odd offset -> odd sum
    prog = [e("addi", 1, 0, imm=0x10), e("jalr", 2, 1, imm=1), e("addi", 3, 0, imm=99), e("addi", 3, 0, imm=98),
            e("ecall")]
    iss, _, _ = await lockstep(dut, prog_bytes(*prog), expect_fault=False)
    assert iss.regs[3] == 0
