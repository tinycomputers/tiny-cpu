// Bubble sort of 12 words in DMEM, then prints them space-separated.
#include "common.h"

PROGRAM_BEGIN
        la      s0, array
        li      s1, 12              // n
        // for (pass = n-1; pass > 0; pass--)
        addi    s2, s1, -1
1:      blez    s2, 5f
        li      t0, 0               // i
        mv      t1, s0              // &array[i]
2:      bge     t0, s2, 4f
        lw      a1, 0(t1)
        lw      a2, 4(t1)
        ble     a1, a2, 3f
        sw      a2, 0(t1)
        sw      a1, 4(t1)
3:      addi    t0, t0, 1
        addi    t1, t1, 4
        j       2b
4:      addi    s2, s2, -1
        j       1b
5:      li      s2, 0               // print loop
6:      bge     s2, s1, 8f
        slli    t0, s2, 2
        add     t0, t0, s0
        lw      a0, 0(t0)
        call    print_uint
        PUTCI(' ')
        addi    s2, s2, 1
        j       6b
8:      PUTCI('\n')
        EXIT(1)

PRINT_UINT_ROUTINE

        .data
        .align  2
array:  .word  42, 7, 99, 3, 18, 64, 1, 27, 85, 11, 50, 5
