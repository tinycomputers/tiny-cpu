// Copies 16 words with a byte-granular memcpy, verifies them, and prints OK or FAIL.
#include "common.h"

PROGRAM_BEGIN
        la      a0, dst
        la      a1, src
        li      a2, 64
        call    memcpy
        // compare word by word
        la      t0, dst
        la      t1, src
        li      t2, 16
1:      beqz    t2, ok
        lw      t3, 0(t0)
        lw      t4, 0(t1)
        bne     t3, t4, bad
        addi    t0, t0, 4
        addi    t1, t1, 4
        addi    t2, t2, -1
        j       1b
ok:     la      a0, s_ok
        call    print_str
        EXIT(1)
bad:    la      a0, s_bad
        call    print_str
        EXIT(3)

// memcpy(a0 = dst, a1 = src, a2 = bytes)
memcpy: beqz    a2, 2f
1:      lbu     t0, 0(a1)
        sb      t0, 0(a0)
        addi    a0, a0, 1
        addi    a1, a1, 1
        addi    a2, a2, -1
        bnez    a2, 1b
2:      ret

PRINT_STR_ROUTINE

        .data
        .align  2
src:    .word   0x00000001, 0xdeadbeef, 0x80000000, 0x7fffffff, 0xffffffff, 0x12345678, 0x0badf00d, 0xcafebabe
        .word   0x0f0f0f0f, 0xf0f0f0f0, 0x00ff00ff, 0xff00ff00, 0x13579bdf, 0x2468ace0, 0x55aa55aa, 0xaa55aa55
dst:    .space  64
s_ok:   .asciz  "OK\n"
s_bad:  .asciz  "FAIL\n"
