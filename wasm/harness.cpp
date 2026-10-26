// Phase 5: both microarchitectures of tiny_cpu_top in one WebAssembly module.
//
// tiny_cpu_top is Verilated twice - CORE="SINGLE" and CORE="PIPE", distinct --prefix - and each
// model is wrapped by a Model<Top>. TinyCpuSim owns both and selects one with reset(core).
// Program memory is written into both, so either core can be selected after loading.
//
// Nothing here re-implements the design: every value returned comes from an output port of the
// Verilated model. The one exception is data memory. The RTL does not expose it, so the harness
// keeps a shadow copy updated from the retire records (rvfi_mem_*), which the RTL drives with the
// exact lane-positioned store data. Loads never change memory, so the shadow is exact.
#include "Vcpu_pipe.h"
#include "Vcpu_single.h"
#include "verilated.h"

#include <emscripten/bind.h>

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

using emscripten::val;

namespace {

constexpr uint32_t IMEM_WORDS = 1024;
constexpr uint32_t DMEM_WORDS = 1024;
constexpr uint32_t DMEM_BASE = 0x0001'0000;
constexpr uint32_t DMEM_BYTES = DMEM_WORDS * 4;
constexpr uint32_t CONSOLE_ADDR = 0x0002'0000;

// Everything one clock edge exposes, copied out of the model.
struct Snap {
    bool halted = false, fault = false;
    bool rvfi_valid = false, rvfi_halt = false, rvfi_cycle_dep = false, rvfi_misaligned = false;
    uint32_t order = 0, pc = 0, insn = 0, rd_wdata = 0, pc_wdata = 0;
    uint32_t mem_addr = 0, mem_rdata = 0, mem_wdata = 0;
    uint8_t rd_addr = 0, mem_rmask = 0, mem_wmask = 0;
    uint32_t dbg_pc = 0, instret = 0, cycle = 0;
    uint8_t stage_valid = 0;
    std::array<uint32_t, 5> stage_pc{}, stage_insn{};
    bool stall = false, load_use = false, flush_ifid = false, flush_idex = false;
    uint8_t fwd_a = 0, fwd_b = 0;
    std::array<uint32_t, 32> regs{};
    bool console_valid = false;
    uint8_t console_data = 0;
    bool tohost_valid = false;
    uint32_t tohost_data = 0;
};

class ModelIface {
public:
    virtual ~ModelIface() = default;
    virtual void setForwarding(bool on) = 0;
    virtual void assertReset() = 0;          // async reset held; the clock may still run
    virtual void releaseReset() = 0;         // rst_n high; the next edge executes instruction 0
    virtual void writeWord(bool dmem, uint32_t index, uint32_t data) = 0;  // requires reset held
    virtual void tick() = 0;                 // one rising clock edge
    virtual Snap snapshot() const = 0;
    virtual void clearRun() = 0;             // console and shadow tohost, for a new run
    virtual std::vector<uint8_t> readDmem(uint32_t offset, uint32_t len) const = 0;
    virtual const std::string& console() const = 0;
};

template <class Top>
class Model final : public ModelIface {
public:
    Model() : ctx_(new VerilatedContext), top_(new Top(ctx_, "TOP")), dmem_(DMEM_BYTES, 0) {
        top_->clk = 0;
        top_->rst_n = 0;
        top_->cfg_forward_en = 1;
        top_->load_en = 0;
        top_->load_sel = 0;
        top_->load_addr = 0;
        top_->load_data = 0;
        top_->eval();
    }

    ~Model() override {
        top_->final();
        delete top_;
        delete ctx_;
    }

    void setForwarding(bool on) override { top_->cfg_forward_en = on ? 1 : 0; }

    void assertReset() override {
        top_->load_en = 0;
        top_->rst_n = 0;
        top_->clk = 0;
        top_->eval();
    }

    void releaseReset() override {
        top_->rst_n = 1;
        top_->clk = 0;
        top_->eval();
    }

    void writeWord(bool dmem, uint32_t index, uint32_t data) override {
        top_->load_en = 1;
        top_->load_sel = dmem ? 1 : 0;
        top_->load_addr = index;
        top_->load_data = data;
        tick();
        top_->load_en = 0;
        if (dmem) {
            for (uint32_t b = 0; b < 4; ++b) dmem_[index * 4 + b] = (data >> (8 * b)) & 0xFF;
        }
    }

    void tick() override {
        top_->clk = 0;
        top_->eval();
        top_->clk = 1;
        top_->eval();
        if (top_->console_valid) console_.push_back(static_cast<char>(top_->console_data));
        if (top_->rvfi_valid && top_->rvfi_mem_wmask && top_->rvfi_mem_addr >= DMEM_BASE &&
            top_->rvfi_mem_addr < DMEM_BASE + DMEM_BYTES) {
            const uint32_t off = top_->rvfi_mem_addr - DMEM_BASE;
            for (uint32_t b = 0; b < 4; ++b) {
                if (top_->rvfi_mem_wmask >> b & 1) dmem_[off + b] = (top_->rvfi_mem_wdata >> (8 * b)) & 0xFF;
            }
        }
    }

    Snap snapshot() const override {
        Snap s;
        s.halted = top_->halted;
        s.fault = top_->fault;
        s.rvfi_valid = top_->rvfi_valid;
        s.rvfi_halt = top_->rvfi_halt;
        s.rvfi_cycle_dep = top_->rvfi_cycle_dep;
        s.rvfi_misaligned = top_->rvfi_misaligned;
        s.order = top_->rvfi_order;
        s.pc = top_->rvfi_pc;
        s.insn = top_->rvfi_insn;
        s.rd_addr = top_->rvfi_rd_addr;
        s.rd_wdata = top_->rvfi_rd_wdata;
        s.pc_wdata = top_->rvfi_pc_wdata;
        s.mem_addr = top_->rvfi_mem_addr;
        s.mem_rmask = top_->rvfi_mem_rmask;
        s.mem_wmask = top_->rvfi_mem_wmask;
        s.mem_rdata = top_->rvfi_mem_rdata;
        s.mem_wdata = top_->rvfi_mem_wdata;
        s.dbg_pc = top_->dbg_pc;
        s.instret = top_->dbg_instret;
        s.cycle = top_->dbg_cycle;
        s.stage_valid = top_->dbg_stage_valid;
        for (uint32_t i = 0; i < 5; ++i) {
            s.stage_pc[i] = top_->dbg_stage_pc[i];
            s.stage_insn[i] = top_->dbg_stage_insn[i];
        }
        s.stall = top_->dbg_stall;
        s.load_use = top_->dbg_load_use;
        s.flush_ifid = top_->dbg_flush_ifid;
        s.flush_idex = top_->dbg_flush_idex;
        s.fwd_a = top_->dbg_fwd_a;
        s.fwd_b = top_->dbg_fwd_b;
        for (uint32_t i = 0; i < 32; ++i) s.regs[i] = top_->dbg_regs[i];
        s.console_valid = top_->console_valid;
        s.console_data = top_->console_data;
        s.tohost_valid = top_->tohost_valid;
        s.tohost_data = top_->tohost_data;
        return s;
    }

    void clearRun() override { console_.clear(); }

    std::vector<uint8_t> readDmem(uint32_t offset, uint32_t len) const override {
        std::vector<uint8_t> out;
        for (uint32_t i = 0; i < len && offset + i < DMEM_BYTES; ++i) out.push_back(dmem_[offset + i]);
        return out;
    }

    const std::string& console() const override { return console_; }

private:
    VerilatedContext* ctx_;
    Top* top_;
    std::vector<uint8_t> dmem_;
    std::string console_;
};

// Length of a JS array-like (plain array or typed array).
uint32_t lengthOf(const val& arr) { return arr["length"].as<uint32_t>(); }

}  // namespace

class TinyCpuSim {
public:
    TinyCpuSim()
        : single_(std::make_unique<Model<Vcpu_single>>()), pipe_(std::make_unique<Model<Vcpu_pipe>>()) {
        active_ = single_.get();
    }

    // Selects the core and asserts reset on both models. Returns false for an unknown core name.
    bool reset(const std::string& core) {
        if (core == "SINGLE") {
            active_ = single_.get();
        } else if (core == "PIPE") {
            active_ = pipe_.get();
        } else {
            return false;
        }
        single_->assertReset();
        pipe_->assertReset();
        for (ModelIface* m : {static_cast<ModelIface*>(single_.get()), static_cast<ModelIface*>(pipe_.get())}) {
            m->setForwarding(forward_);
            m->clearRun();
        }
        cycles_ = 0;
        started_ = false;
        return true;
    }

    // Takes effect at the next reset(). Forwarding only matters for PIPE; SINGLE ignores it.
    void setForwarding(bool on) { forward_ = on; }

    // Loads IMEM from a JS array of 32-bit words. Both models are held in reset while loading.
    bool loadImem(const val& words) {
        const uint32_t n = lengthOf(words);
        if (n > IMEM_WORDS) return false;
        single_->assertReset();
        pipe_->assertReset();
        for (uint32_t i = 0; i < IMEM_WORDS; ++i) {
            const uint32_t w = i < n ? words[i].as<uint32_t>() : 0;
            single_->writeWord(false, i, w);
            pipe_->writeWord(false, i, w);
        }
        return true;
    }

    // Loads DMEM from a JS array of bytes (little-endian words), padded with zeros.
    bool loadDmem(const val& bytes) {
        const uint32_t n = lengthOf(bytes);
        if (n > DMEM_BYTES) return false;
        single_->assertReset();
        pipe_->assertReset();
        for (uint32_t i = 0; i < DMEM_WORDS; ++i) {
            uint32_t w = 0;
            for (uint32_t b = 0; b < 4; ++b) {
                const uint32_t idx = i * 4 + b;
                if (idx < n) w |= static_cast<uint32_t>(bytes[idx].as<uint8_t>()) << (8 * b);
            }
            single_->writeWord(true, i, w);
            pipe_->writeWord(true, i, w);
        }
        return true;
    }

    // Releases reset on the selected core. Cycle counting starts here.
    void start() {
        active_->releaseReset();
        cycles_ = 0;
        started_ = true;
    }

    // One clock edge. Returns the CycleState for that edge (see docs/STATE_SCHEMA.md).
    val step() {
        if (!started_) return val::null();
        if (!finished()) {
            active_->tick();
            ++cycles_;
        }
        return toState(active_->snapshot());
    }

    // Steps until halted, faulted or maxCycles, returning every CycleState (the last is the halt).
    val run(uint32_t maxCycles) {
        val out = val::array();
        for (uint32_t i = 0; i < maxCycles && !finished(); ++i) {
            out.call<void>("push", step());
        }
        return out;
    }

    // Steps until halted, faulted or maxCycles without building per-cycle states.
    val runFast(uint32_t maxCycles) {
        if (started_) {
            for (uint32_t i = 0; i < maxCycles && !finished(); ++i) {
                active_->tick();
                ++cycles_;
            }
        }
        const Snap s = active_->snapshot();
        val out = val::object();
        out.set("cycles", cycles_);
        out.set("instret", s.instret);
        out.set("halted", s.halted);
        out.set("fault", s.fault);
        out.set("tohost", s.tohost_valid ? val(s.tohost_data) : val::null());
        out.set("console", active_->console());
        return out;
    }

    val getRegs() const {
        const Snap s = active_->snapshot();
        val out = val::array();
        for (uint32_t i = 0; i < 32; ++i) out.call<void>("push", s.regs[i]);
        return out;
    }

    // Bytes of data memory at an absolute address (DMEM_BASE-relative), from the shadow copy.
    val readDmem(uint32_t addr, uint32_t len) const {
        val out = val::array();
        if (addr < DMEM_BASE) return out;
        for (uint8_t b : active_->readDmem(addr - DMEM_BASE, len)) out.call<void>("push", static_cast<uint32_t>(b));
        return out;
    }

    std::string getConsole() const { return active_->console(); }
    uint32_t getCycleCount() const { return cycles_; }
    bool isHalted() const { return active_->snapshot().halted; }
    bool isFault() const { return active_->snapshot().fault; }

private:
    bool finished() const {
        const Snap s = active_->snapshot();
        return s.halted || s.fault;
    }

    val toState(const Snap& s) const {
        val st = val::object();
        st.set("cycle", cycles_);
        st.set("halted", s.halted);
        st.set("fault", s.fault);
        val stages = val::array();
        static const char* kNames[5] = {"IF", "ID", "EX", "MEM", "WB"};
        for (uint32_t i = 0; i < 5; ++i) {
            val stg = val::object();
            stg.set("name", std::string(kNames[i]));
            stg.set("valid", static_cast<bool>(s.stage_valid >> i & 1));
            stg.set("pc", s.stage_pc[i]);
            stg.set("insn", s.stage_insn[i]);
            stages.call<void>("push", stg);
        }
        st.set("stages", stages);
        val hz = val::object();
        hz.set("stall", s.stall);
        hz.set("loadUse", s.load_use);
        hz.set("flushIFID", s.flush_ifid);
        hz.set("flushIDEX", s.flush_idex);
        hz.set("fwdA", static_cast<uint32_t>(s.fwd_a));
        hz.set("fwdB", static_cast<uint32_t>(s.fwd_b));
        st.set("hazard", hz);
        val regs = val::array();
        for (uint32_t i = 0; i < 32; ++i) regs.call<void>("push", s.regs[i]);
        st.set("regs", regs);
        if (s.rvfi_valid) {
            val r = val::object();
            r.set("order", s.order);
            r.set("pc", s.pc);
            r.set("insn", s.insn);
            r.set("rdAddr", static_cast<uint32_t>(s.rd_addr));
            r.set("rdWdata", s.rd_wdata);
            r.set("pcWdata", s.pc_wdata);
            r.set("memAddr", s.mem_addr);
            r.set("memRmask", static_cast<uint32_t>(s.mem_rmask));
            r.set("memWmask", static_cast<uint32_t>(s.mem_wmask));
            r.set("memRdata", s.mem_rdata);
            r.set("memWdata", s.mem_wdata);
            r.set("misaligned", s.rvfi_misaligned);
            r.set("halt", s.rvfi_halt);
            r.set("cycleDep", s.rvfi_cycle_dep);
            st.set("retired", r);
        } else {
            st.set("retired", val::null());
        }
        st.set("console", s.console_valid ? val(static_cast<uint32_t>(s.console_data)) : val::null());
        st.set("tohost", s.tohost_valid ? val(s.tohost_data) : val::null());
        val counters = val::object();
        counters.set("cycle", cycles_);
        counters.set("instret", s.instret);
        st.set("counters", counters);
        return st;
    }

    std::unique_ptr<Model<Vcpu_single>> single_;
    std::unique_ptr<Model<Vcpu_pipe>> pipe_;
    ModelIface* active_ = nullptr;
    bool forward_ = true;
    bool started_ = false;
    uint32_t cycles_ = 0;
};
