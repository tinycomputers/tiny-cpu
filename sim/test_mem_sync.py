import random

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, Timer

READ_NEW = int(__import__("os").environ.get("MEM_READ_NEW", "1"))


async def setup(dut):
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.re.value, dut.raddr.value, dut.wmask.value = 1, 0, 0
    dut.waddr.value = dut.wdata.value = dut.ld_en.value = dut.ld_addr.value = dut.ld_data.value = 0
    await FallingEdge(dut.clk)


async def edge(dut, **kw):
    """Apply inputs at the falling edge; the following rising edge samples them."""
    for k, v in kw.items():
        getattr(dut, k).value = v
    await FallingEdge(dut.clk)
    dut.wmask.value, dut.ld_en.value = 0, 0
    return int(dut.rdata.value)


@cocotb.test()
async def read_data_arrives_one_clock_after_the_address(dut):
    await setup(dut)
    await edge(dut, ld_en=1, ld_addr=3, ld_data=0xAABBCCDD)
    await edge(dut, ld_en=1, ld_addr=4, ld_data=0x11223344)
    assert await edge(dut, raddr=3) == 0xAABBCCDD
    assert await edge(dut, raddr=4) == 0x11223344
    assert await edge(dut, raddr=4) == 0x11223344  # address unchanged -> data unchanged


@cocotb.test()
async def re_low_holds_the_output(dut):
    await setup(dut)
    await edge(dut, ld_en=1, ld_addr=1, ld_data=0x1111)
    await edge(dut, ld_en=1, ld_addr=2, ld_data=0x2222)
    assert await edge(dut, raddr=1) == 0x1111
    assert await edge(dut, re=0, raddr=2) == 0x1111  # held, not updated
    assert await edge(dut, re=1, raddr=2) == 0x2222


@cocotb.test()
async def byte_masked_writes(dut):
    await setup(dut)
    await edge(dut, ld_en=1, ld_addr=7, ld_data=0x44332211)
    await edge(dut, waddr=7, wdata=0xAABBCCDD, wmask=0b0110)
    assert await edge(dut, raddr=7) == 0x44BBCC11


@cocotb.test()
async def same_edge_read_and_write(dut):
    """The store-then-load case: read and write the same word on one edge."""
    await setup(dut)
    await edge(dut, ld_en=1, ld_addr=9, ld_data=0x44332211)
    got = await edge(dut, raddr=9, waddr=9, wdata=0xAABBCCDD, wmask=0b0101)
    want_new, want_old = 0x44BB22DD, 0x44332211
    assert got == (want_new if READ_NEW else want_old), f"{got:#x}"
    assert await edge(dut, raddr=9) == want_new  # the write itself happened either way
    # a write to a different word never disturbs the read
    assert await edge(dut, raddr=9, waddr=10, wdata=0xFFFFFFFF, wmask=0xF) == want_new


@cocotb.test()
async def random_traffic_matches_a_model(dut):
    await setup(dut)
    rng = random.Random(42)
    model = [0] * 16
    for i in range(16):
        await edge(dut, ld_en=1, ld_addr=i, ld_data=0)
    for _ in range(500):
        ra, wa = rng.randrange(16), rng.randrange(16)
        wmask, wdata = rng.randrange(16), rng.getrandbits(32)
        old = list(model)
        for b in range(4):
            if wmask >> b & 1:
                model[wa] = (model[wa] & ~(0xFF << 8 * b)) | (wdata & (0xFF << 8 * b))
        got = await edge(dut, raddr=ra, waddr=wa, wdata=wdata, wmask=wmask)
        want = model[ra] if (READ_NEW and ra == wa) else old[ra]
        assert got == want, f"read {ra} write {wa}/{wmask:#x}: {got:#x} != {want:#x}"
