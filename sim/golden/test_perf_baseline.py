"""The pinned cycle counts must not drift unnoticed (change them deliberately: python -m golden.perf --update)."""

import json
import os

import pytest

from golden.perf import BASELINE, SW_PROGRAMS, measure_all


def test_baseline_matches_measurement():
    pinned = json.loads(BASELINE.read_text())
    got = measure_all()
    if not all(name in got for name in SW_PROGRAMS):
        if os.environ.get("REQUIRE_RISCV_TESTS") == "1":
            pytest.fail("sw programs not built (make -C sw programs)")
        pytest.skip("sw programs not built; only checking hazard_free entries")
    assert got == pinned


def test_baseline_entries_that_do_not_need_a_toolchain():
    pinned = json.loads(BASELINE.read_text())
    for name, d in measure_all().items():
        if name.startswith("hazard_free/"):
            assert pinned[name] == d, name


def test_forwarding_never_hurts_and_pipeline_beats_nothing_it_cannot():
    for name, d in json.loads(BASELINE.read_text()).items():
        assert d["pipe_fwd"] <= d["pipe_nofwd"], name           # forwarding only removes stalls
        assert d["pipe_fwd"] >= d["instret"] + 4, name          # never faster than one per cycle + fill
        assert d["single"] == d["instret"], name                # single-cycle CPI is exactly 1
