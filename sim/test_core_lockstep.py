"""core_single vs golden ISS over every riscv-tests image and example program, plus directed cases.

Build the images first: make -C sw all.   REQUIRE_RISCV_TESTS=1 turns a missing build into a failure.
(The 5-stage core has its own file: test_pipe_lockstep.py.)
"""

import os
from pathlib import Path

import cocotb

from lockstep_lib import EXPECTED, IMEM_SIZE, e, images, lockstep, prog_bytes, stem_path

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
