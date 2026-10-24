// Iterative Fibonacci: prints fib(20) = 6765.
#include "common.h"

PROGRAM_BEGIN
        li      s0, 20              // n
        li      a1, 0               // fib(i)
        li      a2, 1               // fib(i+1)
1:      beqz    s0, 2f
        add     a3, a1, a2
        mv      a1, a2
        mv      a2, a3
        addi    s0, s0, -1
        j       1b
2:      mv      a0, a1
        call    print_uint
        PUTCI('\n')
        EXIT(1)

PRINT_UINT_ROUTINE
