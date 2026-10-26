#!/usr/bin/env bash
# Downloads the prebuilt xPack riscv-none-elf-gcc into .tools/riscv-gcc (no root needed).
set -euo pipefail
cd "$(dirname "$0")"
VER=15.2.0-1
URL="https://github.com/xpack-dev-tools/riscv-none-elf-gcc-xpack/releases/download/v${VER}/xpack-riscv-none-elf-gcc-${VER}-linux-x64.tar.gz"
if [ ! -x riscv-gcc/bin/riscv-none-elf-gcc ]; then
  curl -sL "$URL" -o riscv-gcc.tar.gz
  rm -rf riscv-gcc && mkdir riscv-gcc
  tar -xzf riscv-gcc.tar.gz -C riscv-gcc --strip-components=1
  rm riscv-gcc.tar.gz
fi
echo RISCV_GCC_DONE
