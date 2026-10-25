import itertools

import cocotb
from cocotb.triggers import Timer


def want(fwd, redirect, id_valid, u1, u2, r1, r2, ex_wr, ex_late, ex_rd, mm_wr, mm_rd):
    def needs(u, rs, rd):
        return bool(u and rs != 0 and rs == rd)

    ex_hit = ex_wr and (needs(u1, r1, ex_rd) or needs(u2, r2, ex_rd))
    mm_hit = mm_wr and (needs(u1, r1, mm_rd) or needs(u2, r2, mm_rd))
    live = id_valid and not redirect
    load_use = live and ex_hit and ex_late
    stall = live and ((ex_hit and ex_late) if fwd else (ex_hit or mm_hit))
    return int(stall), int(load_use)


@cocotb.test()
async def exhaustive(dut):
    regs = (0, 1, 2)
    n = 0
    for fwd, redirect, id_valid, u1, u2, ex_wr, ex_late, mm_wr in itertools.product((0, 1), repeat=8):
        for r1, r2, ex_rd, mm_rd in itertools.product(regs, repeat=4):
            dut.forward_en.value, dut.redirect.value, dut.id_valid.value = fwd, redirect, id_valid
            dut.id_uses_rs1.value, dut.id_uses_rs2.value = u1, u2
            dut.id_rs1.value, dut.id_rs2.value = r1, r2
            dut.ex_wr.value, dut.ex_late.value, dut.ex_rd.value = ex_wr, ex_late, ex_rd
            dut.mm_wr.value, dut.mm_rd.value = mm_wr, mm_rd
            await Timer(1, "ns")
            s, lu = want(fwd, redirect, id_valid, u1, u2, r1, r2, ex_wr, ex_late, ex_rd, mm_wr, mm_rd)
            ctx = (f"fwd={fwd} redir={redirect} v={id_valid} uses={u1}{u2} id=({r1},{r2}) "
                   f"ex={ex_wr}/late{ex_late}:{ex_rd} mm={mm_wr}:{mm_rd}")
            assert int(dut.stall.value) == s, f"stall {ctx}"
            assert int(dut.load_use.value) == lu, f"load_use {ctx}"
            n += 1
    assert n == 256 * 81
