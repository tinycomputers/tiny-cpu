"""The ISS must pass the official rv32ui-p-* tests before any RTL exists (Phase 1 exit criterion).

Build them first:  bash .tools/riscv-gcc.sh && source scripts/env.sh && make -C sw riscv-tests
Set REQUIRE_RISCV_TESTS=1 (CI does) to fail instead of skip when the images are missing.
"""

import os
from pathlib import Path

import pytest

from golden.iss import Iss

BUILD = Path(__file__).resolve().parents[2] / "sw" / "build" / "riscv-tests"
STEMS = sorted(p.name.removesuffix(".imem.bin") for p in BUILD.glob("rv32ui-p-*.imem.bin"))
REQUIRE = os.environ.get("REQUIRE_RISCV_TESTS") == "1"

# 42 sources in riscv-tests/isa/rv32ui minus fence_i and ma_data (see sw/Makefile).
EXPECTED_COUNT = 40


def test_images_present():
    if not STEMS:
        msg = "no riscv-tests images in sw/build/riscv-tests (run `make -C sw riscv-tests`)"
        if REQUIRE:
            pytest.fail(msg)
        pytest.skip(msg)
    assert len(STEMS) == EXPECTED_COUNT, f"expected {EXPECTED_COUNT} tests, found {len(STEMS)}"


@pytest.mark.parametrize("stem", STEMS or ["<not-built>"])
def test_rv32ui(stem):
    if stem == "<not-built>":
        pytest.skip("riscv-tests not built")
    iss = Iss.from_build(BUILD / stem)
    trace = iss.run(max_steps=100_000)
    tail = "\n".join(str(r) for r in trace[-6:])
    assert iss.passed, (
        f"{stem}: tohost={iss.tohost} -> failed test case #{(iss.tohost or 0) >> 1}\nlast retires:\n{tail}"
    )
