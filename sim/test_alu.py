import random

import cocotb
from cocotb.triggers import Timer

from consts import ALU
from golden.iss import _alu  # the golden model's ALU is the oracle

EDGE = [0, 1, 2, 31, 32, 33, 0x7FFFFFFF, 0x80000000, 0x80000001, 0xFFFFFFFF, 0xFFFFFFFE, 0x55555555, 0xAAAAAAAA]


def ref(op, a, b):
    return b if op == "COPY_B" else _alu(op.lower(), a, b)


async def check(dut, op, a, b):
    dut.a.value, dut.b.value, dut.op.value = a, b, ALU[op]
    await Timer(1, "ns")
    got = int(dut.y.value)
    assert got == ref(op, a, b), f"{op}({a:#x}, {b:#x}) = {got:#x}, want {ref(op, a, b):#x}"


@cocotb.test()
async def every_op_edge_and_random(dut):
    rng = random.Random(42)
    for op in ALU:
        pairs = [(a, b) for a in EDGE for b in EDGE]
        pairs += [(rng.getrandbits(32), rng.getrandbits(32)) for _ in range(300)]
        for a, b in pairs:
            await check(dut, op, a, b)


@cocotb.test()
async def shifts_use_only_low_five_bits_of_b(dut):
    rng = random.Random(7)
    for op in ("SLL", "SRL", "SRA"):
        for sh in range(64):  # shamt 32..63 must wrap
            for a in (1, 0x80000000, 0xDEADBEEF, rng.getrandbits(32)):
                await check(dut, op, a, sh | (rng.getrandbits(27) << 5))
