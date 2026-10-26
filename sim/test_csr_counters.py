import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, Timer


async def setup(dut):
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.retire.value, dut.csr_addr.value, dut.rst_n.value = 0, 0, 0
    await Timer(12, "ns")
    dut.rst_n.value = 1
    await FallingEdge(dut.clk)


async def csr(dut, addr):
    dut.csr_addr.value = addr
    await Timer(1, "ns")
    return int(dut.csr_rdata.value)


@cocotb.test()
async def cycle_counts_every_clock_instret_only_on_retire(dut):
    await setup(dut)
    for _ in range(10):
        await FallingEdge(dut.clk)
    assert await csr(dut, 0xC00) == 10
    assert await csr(dut, 0xC01) == 10  # time aliases cycle
    assert await csr(dut, 0xC02) == 0
    assert int(dut.cycle_lo.value) == 10
    dut.retire.value = 1
    for _ in range(4):
        await FallingEdge(dut.clk)
    dut.retire.value = 0
    for _ in range(3):
        await FallingEdge(dut.clk)
    assert await csr(dut, 0xC02) == 4 == int(dut.instret_lo.value)
    assert await csr(dut, 0xC00) == 17
    assert await csr(dut, 0xC80) == await csr(dut, 0xC81) == await csr(dut, 0xC82) == 0
    assert await csr(dut, 0x300) == 0  # unknown CSR reads zero (the decoder never lets it through)


@cocotb.test()
async def reset_clears_counters(dut):
    await setup(dut)
    for _ in range(5):
        await FallingEdge(dut.clk)
    dut.rst_n.value = 0
    await Timer(1, "ns")
    assert await csr(dut, 0xC00) == 0
