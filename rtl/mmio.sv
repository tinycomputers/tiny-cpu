// Data-side address decode and the three MMIO registers (docs/PLAN.md section 2.1).
//   CONSOLE 0x0002_0000  write-only; lane-0 byte is printed
//   TOHOST  0x0002_0004  write-only, word stores only; halts the core
//   CYCLE   0x0002_0008  read-only cycle counter
// `fault` follows the golden ISS exactly: loads may hit DMEM or CYCLE; stores may hit DMEM,
// CONSOLE, or TOHOST (word-wide). Everything else - IMEM, unmapped, read of a write-only
// register, write of a read-only one - is a bus fault.
module mmio
    import tiny_cpu_pkg::*;
(
    input  logic [31:0] word_addr,   // word-aligned address from the LSU
    input  logic        re,
    input  logic        we,
    input  logic [3:0]  wmask,
    input  logic [31:0] wdata,       // lane-positioned
    input  logic [31:0] cycle,
    output logic        hit_dmem,
    output logic [31:0] mmio_rdata,
    output logic        console_we,
    output logic [7:0]  console_data,
    output logic        tohost_we,
    output logic [31:0] tohost_data,
    output logic        fault
);

    localparam logic [31:0] DMEM_BYTES = 32'(DMEM_WORDS * 4);

    logic hit_console, hit_tohost, hit_cycle;

    assign hit_dmem    = (word_addr >= DMEM_BASE) && (word_addr < DMEM_BASE + DMEM_BYTES);
    assign hit_console = (word_addr == CONSOLE_ADDR);
    assign hit_tohost  = (word_addr == TOHOST_ADDR);
    assign hit_cycle   = (word_addr == CYCLE_ADDR);

    assign mmio_rdata   = hit_cycle ? cycle : 32'b0;
    assign console_we   = we && hit_console && wmask[0];
    assign console_data = wdata[7:0];
    assign tohost_we    = we && hit_tohost && (wmask == 4'hF);
    assign tohost_data  = wdata;

    assign fault = (re && !(hit_dmem || hit_cycle)) ||
                   (we && !(hit_dmem || hit_console || (hit_tohost && wmask == 4'hF)));

endmodule
