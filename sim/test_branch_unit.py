import itertools

import cocotb
from cocotb.triggers import Timer

from golden.decode import s32

VALS = [0, 1, 2, 0x7FFFFFFF, 0x80000000, 0x80000001, 0xFFFFFFFE, 0xFFFFFFFF, 0x12345678]
REF = {
    0: lambda a, b: a == b,
    1: lambda a, b: a != b,
    4: lambda a, b: s32(a) < s32(b),
    5: lambda a, b: s32(a) >= s32(b),
    6: lambda a, b: a < b,
    7: lambda a, b: a >= b,
    2: lambda a, b: False,  # reserved encodings never take
    3: lambda a, b: False,
}


@cocotb.test()
async def all_conditions(dut):
    for f3, (a, b) in itertools.product(REF, itertools.product(VALS, VALS)):
        dut.a.value, dut.b.value, dut.funct3.value = a, b, f3
        await Timer(1, "ns")
        assert int(dut.taken.value) == int(REF[f3](a, b)), f"funct3={f3} a={a:#x} b={b:#x}"
