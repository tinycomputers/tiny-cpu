"""web/src/lib/__tests__/gnu-asm.json is current. Needs the RISC-V GNU toolchain (riscv-none-elf-gcc)."""

import os
import shutil

import pytest

from golden.gen_asm_fixtures import main


def test_gnu_asm_fixtures_are_current():
    if shutil.which("riscv-none-elf-gcc") is None:
        msg = "riscv-none-elf-gcc not on PATH (bash .tools/riscv-gcc.sh && source scripts/env.sh)"
        if os.environ.get("REQUIRE_RISCV_TESTS") == "1":
            pytest.fail(msg)
        pytest.skip(msg)
    assert main(["--check"]) == 0, "run: cd sim && python -m golden.gen_asm_fixtures"
