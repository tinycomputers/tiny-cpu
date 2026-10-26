import random

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, ReadOnly, RisingEdge, Timer


async def setup(dut):
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.we.value, dut.waddr.value, dut.wdata.value = 0, 0, 0
    dut.raddr1.value = dut.raddr2.value = 0
    dut.rst_n.value = 0
    await Timer(12, "ns")
    dut.rst_n.value = 1
    await FallingEdge(dut.clk)


async def write(dut, addr, val):
    dut.we.value, dut.waddr.value, dut.wdata.value = 1, addr, val
    await FallingEdge(dut.clk)  # the rising edge in between performs the write
    dut.we.value = 0


async def read(dut, a1, a2=0):
    dut.raddr1.value, dut.raddr2.value = a1, a2
    await Timer(1, "ns")
    return int(dut.rdata1.value), int(dut.rdata2.value)


@cocotb.test()
async def reset_clears_everything(dut):
    await setup(dut)
    for i in range(32):
        assert (await read(dut, i, 31 - i)) == (0, 0)
    assert int(dut.dbg_regs.value) == 0


@cocotb.test()
async def write_read_all_registers_and_x0_is_zero(dut):
    await setup(dut)
    rng = random.Random(42)
    model = [0] * 32
    for _ in range(600):
        a, v = rng.randrange(32), rng.getrandbits(32)
        await write(dut, a, v)
        if a:
            model[a] = v
        r1, r2 = rng.randrange(32), rng.randrange(32)
        assert (await read(dut, r1, r2)) == (model[r1], model[r2])
    assert model[0] == 0
    dbg = int(dut.dbg_regs.value)
    assert [(dbg >> (32 * i)) & 0xFFFFFFFF for i in range(32)] == model


@cocotb.test()
async def write_first_bypass(dut):
    await setup(dut)
    await write(dut, 5, 0x1111)
    dut.we.value, dut.waddr.value, dut.wdata.value = 1, 5, 0x2222
    assert (await read(dut, 5, 6)) == (0x2222, 0)  # same-cycle read sees the new value
    dut.waddr.value = 0
    assert (await read(dut, 0, 5)) == (0, 0x1111)  # x0 never bypasses; x5 not yet overwritten
    dut.we.value = 0
    await FallingEdge(dut.clk)
    assert (await read(dut, 5, 5)) == (0x1111, 0x1111)


@cocotb.test()
async def we_low_does_not_write(dut):
    await setup(dut)
    dut.we.value, dut.waddr.value, dut.wdata.value = 0, 9, 0xDEAD
    await FallingEdge(dut.clk)
    assert (await read(dut, 9)) == (0, 0)
