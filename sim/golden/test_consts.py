"""sim/consts.py must agree with rtl/tiny_cpu_pkg.sv and golden/iss.py."""

import re
from pathlib import Path

import consts
from golden import iss

PKG = (Path(__file__).resolve().parents[2] / "rtl" / "tiny_cpu_pkg.sv").read_text()


def enum_values(prefix: str) -> dict[str, int]:
    return {m.group(1): int(m.group(2)) for m in re.finditer(rf"\b{prefix}_(\w+)\s*=\s*\d+'d(\d+)", PKG)}


def test_enum_encodings_match_package():
    assert enum_values("ALU") == consts.ALU
    assert enum_values("IMM") == consts.IMM
    assert enum_values("WB") == consts.WB
    assert enum_values("SZ") == consts.SZ


def test_memory_map_matches_package_and_iss():
    def pkg(name):
        return int(re.search(rf"{name}\s*=\s*32'h([0-9A-Fa-f_]+)", PKG).group(1).replace("_", ""), 16)

    assert pkg("DMEM_BASE") == consts.DMEM_BASE == iss.DMEM_BASE
    assert pkg("CONSOLE_ADDR") == consts.CONSOLE_ADDR == iss.CONSOLE_ADDR
    assert pkg("TOHOST_ADDR") == consts.TOHOST_ADDR == iss.TOHOST_ADDR
    assert pkg("CYCLE_ADDR") == consts.CYCLE_ADDR == iss.CYCLE_ADDR
    assert int(re.search(r"IMEM_WORDS\s*=\s*(\d+)", PKG).group(1)) * 4 == iss.IMEM_SIZE
    assert int(re.search(r"DMEM_WORDS\s*=\s*(\d+)", PKG).group(1)) * 4 == iss.DMEM_SIZE
