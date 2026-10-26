"""LSU vs the golden ISS: same lane/mask/extension conventions for every size x offset."""

import itertools
import random

import cocotb
from cocotb.triggers import Timer

from consts import SZ
from golden.iss import DMEM_BASE, Iss

NAME = {("BYTE", False): "lb", ("BYTE", True): "lbu", ("HALF", False): "lh", ("HALF", True): "lhu",
        ("WORD", False): "lw", ("WORD", True): "lw"}
STORE = {"BYTE": "sb", "HALF": "sh", "WORD": "sw"}


@cocotb.test()
async def loads_match_iss(dut):
    rng = random.Random(42)
    iss = Iss()
    for (size, uns), off in itertools.product(NAME, range(4)):
        for _ in range(40):
            word = rng.getrandbits(32)
            base = DMEM_BASE + 16
            iss.dmem[16:20] = word.to_bytes(4, "little")
            want_val, want_word_addr, want_mask, want_lanes, want_mis = iss._load(NAME[(size, uns)], base + off, 0, 0)
            dut.addr.value, dut.size.value = base + off, SZ[size]
            dut.is_unsigned.value, dut.store_data.value, dut.mem_word.value = int(uns), 0, word
            await Timer(1, "ns")
            ctx = f"{NAME[(size, uns)]} off={off} word={word:#x}"
            assert int(dut.word_addr.value) == want_word_addr, ctx
            assert int(dut.lane_mask.value) == want_mask, ctx
            assert int(dut.rdata_lanes.value) == want_lanes, ctx
            assert int(dut.load_value.value) == want_val, f"{ctx}: {int(dut.load_value.value):#x} != {want_val:#x}"
            assert bool(int(dut.misaligned.value)) == want_mis, ctx


@cocotb.test()
async def stores_match_iss(dut):
    rng = random.Random(43)
    for size, off in itertools.product(STORE, range(4)):
        for _ in range(40):
            val = rng.getrandbits(32)
            iss = Iss()
            iss.dmem[16:20] = bytes(4)
            want_word_addr, want_mask, want_wdata, want_mis = iss._store(STORE[size], DMEM_BASE + 16 + off, val, 0, 0)
            dut.addr.value, dut.size.value = DMEM_BASE + 16 + off, SZ[size]
            dut.is_unsigned.value, dut.store_data.value, dut.mem_word.value = 0, val, 0
            await Timer(1, "ns")
            ctx = f"{STORE[size]} off={off} val={val:#x}"
            assert int(dut.word_addr.value) == want_word_addr, ctx
            assert int(dut.lane_mask.value) == want_mask, ctx
            assert int(dut.wdata.value) == want_wdata, f"{ctx}: {int(dut.wdata.value):#x} != {want_wdata:#x}"
            assert bool(int(dut.misaligned.value)) == want_mis, ctx
