"""sim/programs/*.S run on the ISS: exact console output and pinned instruction counts.

Build first:  make -C sw programs   (REQUIRE_RISCV_TESTS=1 turns a missing build into a failure)
"""

import json
import os
from pathlib import Path

import pytest

from golden.iss import Iss

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "sw" / "build" / "programs"
EXPECTED = json.loads((ROOT / "sim" / "programs" / "expected.json").read_text())
EXPECTED.pop("_comment")
REQUIRE = os.environ.get("REQUIRE_RISCV_TESTS") == "1"


def _build(name):
    stem = BUILD / name
    if not stem.with_suffix(".imem.bin").exists():
        msg = f"{name} not built (run `make -C sw programs`)"
        if REQUIRE:
            pytest.fail(msg)
        pytest.skip(msg)
    return stem


def test_every_source_has_an_expectation():
    sources = {p.stem for p in (ROOT / "sim" / "programs").glob("*.S")}
    assert sources == set(EXPECTED)


def test_expected_console_matches_independent_python():
    """The JSON must not merely echo the ISS: recompute what the programs should print."""

    def fib(n):
        a, b = 0, 1
        for _ in range(n):
            a, b = b, a + b
        return a

    primes = [n for n in range(2, 61) if all(n % d for d in range(2, int(n**0.5) + 1))]
    data = [42, 7, 99, 3, 18, 64, 1, 27, 85, 11, 50, 5]
    assert EXPECTED["fib"]["console"] == f"{fib(20)}\n"
    assert EXPECTED["sort"]["console"] == "".join(f"{v} " for v in sorted(data)) + "\n"
    assert EXPECTED["primes"]["console"] == "".join(f"{p} " for p in primes) + "\n"


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_program(name):
    iss = Iss.from_build(_build(name))
    iss.run(1_000_000)
    assert iss.passed, f"tohost={iss.tohost}"
    assert iss.console_text == EXPECTED[name]["console"]
    assert iss.instret == EXPECTED[name]["instret"]
