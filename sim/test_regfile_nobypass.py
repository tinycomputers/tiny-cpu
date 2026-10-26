"""regfile with BYPASS=0 (single-cycle core): a read never sees the write happening this cycle."""

import cocotb
from cocotb.triggers import FallingEdge

from test_regfile import read, setup, write


@cocotb.test()
async def read_returns_old_value_during_a_write(dut):
    await setup(dut)
    await write(dut, 5, 0x1111)
    dut.we.value, dut.waddr.value, dut.wdata.value = 1, 5, 0x2222
    assert (await read(dut, 5, 5)) == (0x1111, 0x1111)  # no bypass
    await FallingEdge(dut.clk)  # the write lands at the rising edge
    dut.we.value = 0
    assert (await read(dut, 5, 5)) == (0x2222, 0x2222)
