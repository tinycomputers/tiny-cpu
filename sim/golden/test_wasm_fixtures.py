"""wasm/test/fixtures.json is current and agrees with the golden ISS's own answers."""

from golden.wasm_fixtures import OUT, build_fixture, render, retire_digest  # noqa: F401
from golden.iss import Iss
from golden.hazard_free import PROGRAMS
import json


def test_fixtures_are_current():
    from golden.wasm_fixtures import main

    assert main(["--check"]) == 0, "run: cd sim && python -m golden.wasm_fixtures"


def test_fixture_answers_are_the_expected_ones():
    data = json.loads(OUT.read_text())
    assert data["hazard_free/fib"]["expect"]["dmemHex"] == (6765).to_bytes(4, "little").hex()
    assert data["hazard_free/console_and_csr"]["console"] == "Hi, pipe!\n!"
    assert data["hazard_free/bubble_sort"]["instret"] > 0


def test_fixture_cycles_agree_with_the_pinned_baseline():
    import json as _json

    from golden.perf import BASELINE

    pinned = _json.loads(BASELINE.read_text())
    data = _json.loads(OUT.read_text())
    shared = [k for k in data if k in pinned]
    assert shared, "no fixture is in the perf baseline"
    for name in shared:
        assert data[name]["cycles"] == {
            "single": pinned[name]["single"],
            "pipeFwd": pinned[name]["pipe_fwd"],
            "pipeNoFwd": pinned[name]["pipe_nofwd"],
        }, name


def test_hazard_fixture_shows_the_forwarding_pin():
    data = json.loads(OUT.read_text())
    c = data["hazard_dense/3"]["cycles"]
    assert c["pipeFwd"] != c["pipeNoFwd"]


def test_digest_depends_on_the_retire_stream():
    imem, dmem = PROGRAMS["fib"]().build()
    trace = Iss(imem, dmem).run(200_000)
    d = retire_digest(trace)
    assert d == retire_digest(Iss(imem, dmem).run(200_000))  # deterministic
    tampered = list(trace)
    tampered[5] = type(trace[5])(**{**trace[5].__dict__, "rd_wdata": trace[5].rd_wdata ^ 1})
    assert retire_digest(tampered) != d
