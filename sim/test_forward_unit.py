import itertools

import cocotb
from cocotb.triggers import Timer

NONE, EXMEM, MEMWB = 0, 1, 2


def want(en, ex_valid, uses, rs, mm_wr, mm_rd, wb_wr, wb_rd):
    if not en or not ex_valid or not uses or rs == 0:
        return NONE
    if mm_wr and mm_rd == rs:
        return EXMEM
    if wb_wr and wb_rd == rs:
        return MEMWB
    return NONE


@cocotb.test()
async def exhaustive_over_small_register_space(dut):
    regs = (0, 1, 2)
    n = 0
    for en, ex_valid, u1, u2, mm_wr, wb_wr in itertools.product((0, 1), repeat=6):
        for rs1, rs2, mm_rd, wb_rd in itertools.product(regs, repeat=4):
            dut.forward_en.value, dut.ex_valid.value = en, ex_valid
            dut.ex_uses_rs1.value, dut.ex_uses_rs2.value = u1, u2
            dut.ex_rs1.value, dut.ex_rs2.value = rs1, rs2
            dut.mm_wr.value, dut.mm_rd.value, dut.wb_wr.value, dut.wb_rd.value = mm_wr, mm_rd, wb_wr, wb_rd
            await Timer(1, "ns")
            a = want(en, ex_valid, u1, rs1, mm_wr, mm_rd, wb_wr, wb_rd)
            b = want(en, ex_valid, u2, rs2, mm_wr, mm_rd, wb_wr, wb_rd)
            ctx = f"en={en} v={ex_valid} uses={u1}{u2} rs={rs1},{rs2} mm={mm_wr}:{mm_rd} wb={wb_wr}:{wb_rd}"
            assert int(dut.fwd_a.value) == a, f"fwd_a {ctx}"
            assert int(dut.fwd_b.value) == b, f"fwd_b {ctx}"
            n += 1
    assert n == 64 * 81


@cocotb.test()
async def the_nearer_producer_wins_and_x0_never_forwards(dut):
    dut.forward_en.value = dut.ex_valid.value = dut.ex_uses_rs1.value = dut.ex_uses_rs2.value = 1
    dut.ex_rs1.value, dut.ex_rs2.value = 7, 0
    dut.mm_wr.value = dut.wb_wr.value = 1
    dut.mm_rd.value = dut.wb_rd.value = 7
    await Timer(1, "ns")
    assert int(dut.fwd_a.value) == EXMEM  # both match: the younger result (EX/MEM) wins
    dut.mm_rd.value = dut.wb_rd.value = 0
    await Timer(1, "ns")
    assert int(dut.fwd_b.value) == NONE  # x0
