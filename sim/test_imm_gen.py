import random

import cocotb
from cocotb.triggers import Timer

from consts import IMM
from golden.decode import imm_b, imm_i, imm_j, imm_s, imm_u

REF = {"I": imm_i, "S": imm_s, "B": imm_b, "U": imm_u, "J": imm_j}


@cocotb.test()
async def every_format(dut):
    rng = random.Random(42)
    words = [0, 0xFFFFFFFF, 0x80000000, 0x7FFFFFFF, 0x00000FFF, 0xFFFFF000, 0x7FF00000, 0x80000F80]
    words += [rng.getrandbits(32) for _ in range(2000)]
    for fmt, code in IMM.items():
        for w in words:
            dut.insn.value, dut.sel.value = w, code
            await Timer(1, "ns")
            want = REF[fmt](w) & 0xFFFFFFFF
            assert int(dut.imm.value) == want, f"{fmt} {w:#010x}: got {int(dut.imm.value):#x}, want {want:#x}"


@cocotb.test()
async def undefined_select_gives_zero(dut):
    for sel in (5, 6, 7):
        dut.insn.value, dut.sel.value = 0xFFFFFFFF, sel
        await Timer(1, "ns")
        assert int(dut.imm.value) == 0
