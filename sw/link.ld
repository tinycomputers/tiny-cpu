/* TinyCPU memory map (docs/PLAN.md section 2.1). Harvard: the data port cannot read IMEM,
   so .rodata lives in DMEM next to .data and ships in the dmem image. */
OUTPUT_ARCH(riscv)
ENTRY(_start)

MEMORY
{
    IMEM (rx) : ORIGIN = 0x00000000, LENGTH = 4K
    DMEM (rw) : ORIGIN = 0x00010000, LENGTH = 4K
}

SECTIONS
{
    .text : {
        *(.text.init)
        *(.text .text.*)
    } > IMEM

    .data : {
        *(.rodata .rodata.*)
        *(.data .data.*)
        *(.sdata .sdata.*)
        . = ALIGN(4);
    } > DMEM

    .bss (NOLOAD) : {
        __bss_start = .;
        *(.sbss .sbss.*)
        *(.bss .bss.*)
        *(COMMON)
        . = ALIGN(4);
        __bss_end = .;
    } > DMEM

    _stack_top = ORIGIN(DMEM) + LENGTH(DMEM);

    /DISCARD/ : { *(.comment) *(.note*) *(.eh_frame*) }
}
