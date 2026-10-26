// Shared macros for the TinyCPU asm programs (included by every sim/programs/*.S).
//   CONSOLE 0x0002_0000: store a byte to print it      TOHOST 0x0002_0004: store 1 = PASS
#ifndef TINYCPU_COMMON_H
#define TINYCPU_COMMON_H

#define CONSOLE_HI 0x20          /* lui rX, 0x20 -> 0x0002_0000 */

// Entry point at address 0; sp = top of the 4 KiB DMEM.
#define PROGRAM_BEGIN                                                          \
        .section .text.init;                                                   \
        .globl _start;                                                         \
_start:                                                                        \
        lui     sp, 0x11;

// Print the character in `reg` (clobbers t6).
#define PUTC(reg)                                                              \
        lui     t6, CONSOLE_HI;                                                \
        sb      reg, 0(t6);

// Print an immediate character (clobbers t5, t6).
#define PUTCI(ch)                                                              \
        li      t5, ch;                                                        \
        PUTC(t5)

// Halt with a status code: 1 = PASS, anything else = FAIL.
#define EXIT(code)                                                             \
        li      t5, code;                                                      \
        lui     t6, CONSOLE_HI;                                                \
        sw      t5, 4(t6);                                                     \
9999:   j       9999b;

// print_str: a0 = address of NUL-terminated string. Clobbers t0, t1.
#define PRINT_STR_ROUTINE                                                      \
print_str:                                                                     \
        lui     t1, CONSOLE_HI;                                                \
1:      lbu     t0, 0(a0);                                                     \
        beqz    t0, 2f;                                                        \
        sb      t0, 0(t1);                                                     \
        addi    a0, a0, 1;                                                     \
        j       1b;                                                            \
2:      ret;

// print_uint: a0 = unsigned value, printed in decimal (no newline). Uses 16 bytes of stack.
// Division by 10 is repeated subtraction (no M extension), so keep values small.
#define PRINT_UINT_ROUTINE                                                     \
print_uint:                                                                    \
        addi    sp, sp, -16;                                                   \
        li      t3, 0;                                                         \
        li      t4, 10;                                                        \
1:      li      t0, 0;                                                         \
2:      bltu    a0, t4, 3f;                                                    \
        addi    a0, a0, -10;                                                   \
        addi    t0, t0, 1;                                                     \
        j       2b;                                                            \
3:      addi    a0, a0, 48;                                                    \
        add     t1, sp, t3;                                                    \
        sb      a0, 0(t1);                                                     \
        addi    t3, t3, 1;                                                     \
        mv      a0, t0;                                                        \
        bnez    a0, 1b;                                                        \
4:      addi    t3, t3, -1;                                                    \
        add     t1, sp, t3;                                                    \
        lbu     a0, 0(t1);                                                     \
        lui     t2, CONSOLE_HI;                                                \
        sb      a0, 0(t2);                                                     \
        bnez    t3, 4b;                                                        \
        addi    sp, sp, 16;                                                    \
        ret;

#endif
