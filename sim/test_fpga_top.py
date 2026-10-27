"""The iCE40 top level runs fib on the pipelined core and prints its answer over the UART.

Drives fpga/ice40/fpga_top.sv at the iCEBreaker's 12 MHz, decodes the 115200-baud serial line
(8N1, LSB first), and checks the bytes and the status LEDs. fib prints 6765 and a newline, then
writes PASS to TOHOST.
"""

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ClockCycles, FallingEdge

CLK_HZ = 12_000_000
BAUD = 115_200
BIT_CLKS = CLK_HZ // BAUD  # 104
EXPECTED = b"6765\n"


async def uart_receive(dut, count: int) -> bytes:
    """Read `count` bytes from uart_tx: sample each bit at its middle."""
    out = bytearray()
    for _ in range(count):
        await FallingEdge(dut.uart_tx)  # start bit
        await ClockCycles(dut.clk, BIT_CLKS + BIT_CLKS // 2)  # middle of data bit 0
        value = 0
        for bit in range(8):
            value |= int(dut.uart_tx.value) << bit
            await ClockCycles(dut.clk, BIT_CLKS)
        out.append(value)
    return bytes(out)


@cocotb.test()
async def fib_prints_6765_over_uart(dut):
    cocotb.start_soon(Clock(dut.clk, 1_000_000_000 // CLK_HZ, unit="ns").start())
    # The power-on reset holds for 2^16 clocks; the core then runs fib and the UART drains the FIFO.
    received = await uart_receive(dut, len(EXPECTED))
    assert received == EXPECTED, f"UART carried {received!r}, expected {EXPECTED!r}"

    await ClockCycles(dut.clk, 200)  # let the core reach its halt and the TOHOST write
    led = int(dut.led.value)
    assert led & 0b00010, "tohost_valid (LED 1) not set"
    assert led & 0b00100, "fib did not report PASS (LED 2)"
    assert not led & 0b01000, "core faulted (LED 3)"
    assert not led & 0b10000, "console FIFO overflowed (LED 4)"
    assert not led & 0b00001, "core is still running (LED 0)"
