"""MMIO decode vs the golden ISS's fault rules, for every region and access shape."""

import itertools

import cocotb
from cocotb.triggers import Timer

from consts import CONSOLE_ADDR, CYCLE_ADDR, DMEM_BASE, TOHOST_ADDR
from golden.iss import BusFault, Iss

ADDRS = [0x0, 0x4, 0xFFC, 0x1000, DMEM_BASE - 4, DMEM_BASE, DMEM_BASE + 0xFFC, DMEM_BASE + 0x1000,
         CONSOLE_ADDR - 4, CONSOLE_ADDR, TOHOST_ADDR, CYCLE_ADDR, CYCLE_ADDR + 4, 0x8000_0000, 0xFFFF_FFFC]


def iss_faults(kind, addr, mask):
    iss = Iss()
    try:
        if kind == "load":
            size, off = {1: ("lb", 0), 3: ("lh", 0), 0xF: ("lw", 0)}.get(mask, ("lb", 0))
            iss._load(size, addr, 0, 0)
        else:
            iss._store({1: "sb", 3: "sh", 0xF: "sw"}.get(mask, "sb"), addr, 0xA5, 0, 0)
    except BusFault:
        return True
    return False


async def drive(dut, addr, re, we, mask, wdata=0x1234_5678, cycle=0xCAFE):
    dut.word_addr.value, dut.re.value, dut.we.value = addr, re, we
    dut.wmask.value, dut.wdata.value, dut.cycle.value = mask, wdata, cycle
    await Timer(1, "ns")


@cocotb.test()
async def fault_rules_match_iss(dut):
    for addr, mask in itertools.product(ADDRS, (1, 3, 0xF)):
        await drive(dut, addr, 1, 0, mask)
        assert bool(int(dut.fault.value)) == iss_faults("load", addr, mask), f"load {addr:#x}"
        await drive(dut, addr, 0, 1, mask)
        assert bool(int(dut.fault.value)) == iss_faults("store", addr, mask), f"store {addr:#x} mask={mask:#x}"
        await drive(dut, addr, 0, 0, mask)
        assert int(dut.fault.value) == 0, "no access, no fault"


@cocotb.test()
async def region_hits_and_register_effects(dut):
    await drive(dut, DMEM_BASE + 8, 1, 0, 0xF)
    assert int(dut.hit_dmem.value) == 1 and int(dut.console_we.value) == 0
    await drive(dut, DMEM_BASE + 0x1000, 1, 0, 0xF)
    assert int(dut.hit_dmem.value) == 0
    await drive(dut, CONSOLE_ADDR, 0, 1, 0b0001, wdata=0x41)
    assert int(dut.console_we.value) == 1 and int(dut.console_data.value) == 0x41
    await drive(dut, CONSOLE_ADDR, 0, 1, 0b0010, wdata=0x4100)  # lane 1 only: nothing printed
    assert int(dut.console_we.value) == 0
    await drive(dut, TOHOST_ADDR, 0, 1, 0xF, wdata=1)
    assert int(dut.tohost_we.value) == 1 and int(dut.tohost_data.value) == 1
    await drive(dut, TOHOST_ADDR, 0, 1, 0b0001, wdata=1)
    assert int(dut.tohost_we.value) == 0 and int(dut.fault.value) == 1
    await drive(dut, CYCLE_ADDR, 1, 0, 0xF, cycle=0xBEEF)
    assert int(dut.mmio_rdata.value) == 0xBEEF and int(dut.fault.value) == 0
    await drive(dut, DMEM_BASE, 1, 0, 0xF, cycle=0xBEEF)
    assert int(dut.mmio_rdata.value) == 0
