"""Copy the RTL into a directory Yosys can read.

Yosys's SystemVerilog parser does not resolve package names that are imported with `import pkg::*` (in a module header
or at file scope). The RTL uses them everywhere, so this copies each file and writes every package symbol as
`tiny_cpu_pkg::NAME`, which Yosys does resolve, and removes the import lines. The symbols are read from the package
itself, so the list stays in step with it. The simulators keep reading the original files.

    python3 fpga/prepare_rtl.py <out_dir> <file.sv> ...
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "rtl" / "tiny_cpu_pkg.sv"
IMPORT = re.compile(r"^\s*import\s+tiny_cpu_pkg::\*;\s*$", re.MULTILINE)


def strip_comments(text: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.S))


def package_symbols() -> list[str]:
    text = strip_comments(PKG.read_text())
    names: set[str] = set()
    names.update(re.findall(r"\blocalparam\b[^=;]*?\b(\w+)\s*=", text))
    names.update(re.findall(r"\}\s*(\w+)\s*;", text))  # typedef enum ... { ... } name;
    for body in re.findall(r"enum[^{]*\{([^}]*)\}", text):
        for member in body.split(","):
            m = re.match(r"\s*(\w+)", member)
            if m:
                names.add(m.group(1))
    return sorted(names, key=len, reverse=True)  # longest first, so a name never matches inside a longer one


def convert(text: str, symbols: list[str]) -> str:
    text = IMPORT.sub("", text)
    text = re.sub(r"\bparameter\s+string\b", "parameter", text)  # Yosys reads string parameters only untyped
    pattern = re.compile(r"(?<![\w.$])(?<!::)(" + "|".join(map(re.escape, symbols)) + r")(?!\w)")
    return pattern.sub(lambda m: f"tiny_cpu_pkg::{m.group(1)}", text)


def main(argv: list[str]) -> None:
    out_dir = Path(argv[0])
    out_dir.mkdir(parents=True, exist_ok=True)
    symbols = package_symbols()
    for name in argv[1:]:
        src = Path(name)
        if src.resolve() == PKG.resolve():
            (out_dir / src.name).write_text(src.read_text())  # the package itself is copied unchanged
        else:
            (out_dir / src.name).write_text(convert(src.read_text(), symbols))


if __name__ == "__main__":
    main(sys.argv[1:])
