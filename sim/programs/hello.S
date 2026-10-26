// Prints a greeting through the CONSOLE MMIO register, then reports PASS.
#include "common.h"

PROGRAM_BEGIN
        la      a0, msg
        call    print_str
        EXIT(1)

PRINT_STR_ROUTINE

        .section .rodata
msg:    .asciz "Hello, TinyCPU!\n"
