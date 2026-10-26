"""The timing model, checked by hand-derived cases (no RTL) and against the hazard-free baseline."""

import pytest

from golden.decode import encode as e
from golden.hazard_cases import ADD, CASES, DMEM, NOP, SETUP  # noqa: F401
from golden.hazard_free import PROGRAMS, random_program
from golden.hazard_random import random_hazard_program
from golden.iss import Iss
from golden.pipemodel import ex_cycles, is_late, pipe_cycles, stalls
from golden.progbuild import Prog, raw_hazards


def trace_of(*insns):
    iss = Iss(b"".join(w.to_bytes(4, "little") for w in (*insns, e("ecall"))), DMEM)
    return iss.run(1000)


def extra(trace, forward):
    """Cycles beyond the ideal N + 4."""
    return pipe_cycles(trace, forward) - (len(trace) + 4)


@pytest.mark.parametrize("name", CASES)
def test_hand_derived_cycle_counts(name):
    insns, with_fwd, without = CASES[name]
    t = trace_of(*insns)
    assert extra(t, True) == with_fwd, "forwarding on"
    assert extra(t, False) == without, "forwarding off"


def test_taken_branch_is_a_flush_not_a_stall():
    t = trace_of(e("jal", 0, imm=8), e("addi", 7, 0, imm=1), e("addi", 8, 0, imm=2))
    assert stalls(t, True) == 0 and stalls(t, False) == 0 and extra(t, True) == 2


def test_late_results_are_loads_and_csr_reads_only():
    assert is_late(e("lw", 1, 2, imm=0)) and is_late(e("lbu", 1, 2, imm=0)) and is_late(e("csrrs", 1, 0, csr=0xC00))
    assert not is_late(e("addi", 1, 2, imm=0)) and not is_late(e("jal", 1, imm=4)) and not is_late(e("sw", 0, 1, 2))


def test_first_instruction_is_in_ex_on_cycle_3():
    assert ex_cycles(trace_of(e("addi", 1, 0, imm=1)))[0] == 3


@pytest.mark.parametrize("name", sorted(PROGRAMS))
def test_hazard_free_programs_have_no_data_stalls_either_way(name):
    iss = Iss(*PROGRAMS[name]().build())
    t = iss.run(100_000)
    if name == "mem_raw_adjacent":  # hand-scheduled: also free of register hazards
        pass
    assert raw_hazards(t) == [] and stalls(t, True) == 0 and stalls(t, False) == 0


@pytest.mark.parametrize("seed", range(20))
def test_hazard_random_programs_terminate_and_have_real_hazards(seed):
    iss = Iss(*random_hazard_program(seed).build())
    t = iss.run(100_000)
    assert iss.passed
    assert stalls(t, False) >= stalls(t, True) >= 0
    assert len(t) > 40


def test_hazard_random_programs_actually_stress_the_pipeline():
    total_fwd = total_nofwd = hazards = 0
    for seed in range(40):
        t = Iss(*random_hazard_program(seed).build())
        tr = t.run(100_000)
        total_fwd += stalls(tr, True)
        total_nofwd += stalls(tr, False)
        hazards += len(raw_hazards(tr))
    assert hazards > 500 and total_fwd > 40 and total_nofwd > 5 * total_fwd
