# Builds the official rv32ui riscv-tests and our asm programs for the TinyCPU memory map.
# Outputs per program NAME under build/<group>/:
#   NAME.elf  NAME.imem.bin (from 0x0)  NAME.dmem.bin (from 0x10000)  NAME.dis
#
#   make riscv-tests | programs | all | clean
# Needs riscv-none-elf-gcc on PATH (bash ../.tools/riscv-gcc.sh, then source ../scripts/env.sh).

RISCV   ?= riscv-none-elf
CC      := $(RISCV)-gcc
OBJCOPY := $(RISCV)-objcopy
OBJDUMP := $(RISCV)-objdump

ARCH    := -march=rv32i_zicsr_zifencei -mabi=ilp32
CFLAGS  := $(ARCH) -static -nostdlib -nostartfiles -ffreestanding \
           -I env/tinycpu -I riscv-tests/isa/macros/scalar -I ../sim/programs
LDFLAGS := -T link.ld -Wl,--no-warn-rwx-segments

BUILD := build

# fence_i needs self-modifying code (Harvard: unsupported); ma_data needs misaligned access.
EXCLUDE_TESTS := fence_i ma_data
TEST_NAMES    := $(filter-out $(EXCLUDE_TESTS),$(basename $(notdir $(wildcard riscv-tests/isa/rv32ui/*.S))))
PROG_NAMES    := $(basename $(notdir $(wildcard ../sim/programs/*.S)))

TEST_BINS := $(foreach t,$(TEST_NAMES),$(BUILD)/riscv-tests/rv32ui-p-$(t).dmem.bin)
PROG_BINS := $(foreach p,$(PROG_NAMES),$(BUILD)/programs/$(p).dmem.bin)

.PHONY: all riscv-tests programs clean
.SECONDARY:    # keep .elf/.imem.bin: only the .dmem.bin is a named goal
all: riscv-tests programs
riscv-tests: $(TEST_BINS)
programs: $(PROG_BINS)

$(BUILD)/riscv-tests/rv32ui-p-%.elf: riscv-tests/isa/rv32ui/%.S link.ld env/tinycpu/riscv_test.h
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(LDFLAGS) $< -o $@

$(BUILD)/programs/%.elf: ../sim/programs/%.S ../sim/programs/common.h link.ld
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(LDFLAGS) $< -o $@

%.imem.bin: %.elf
	$(OBJCOPY) -O binary -j .text $< $@

# The imem rule runs first (dmem depends on it) so a single make target yields both images.
%.dmem.bin: %.elf %.imem.bin
	$(OBJCOPY) -O binary -j .data $< $@
	$(OBJDUMP) -d -M no-aliases $< > $*.dis

clean:
	rm -rf $(BUILD)
