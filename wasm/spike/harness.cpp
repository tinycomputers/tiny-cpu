// Phase 0 spike: TWO Verilated models of the same RTL, linked into ONE wasm module.
// Phase 5 needs this for Vcpu_pipe + Vcpu_single; this proves symbols don't collide.
#include "Vcounter_a.h"
#include "Vcounter_b.h"
#include "verilated.h"
#include <emscripten/bind.h>

template <class Model>
class CounterSim {
    VerilatedContext* ctx;
    Model* top;

public:
    CounterSim() {
        ctx = new VerilatedContext;
        top = new Model(ctx, "TOP");
        top->clk = 0;
        top->rst_n = 1;
        top->en = 0;
        top->eval();
    }
    ~CounterSim() {
        top->final();
        delete top;
        delete ctx;
    }
    void reset() {
        top->rst_n = 0;
        top->clk = 0;
        top->eval();
        top->clk = 1;
        top->eval();
        top->rst_n = 1;
        top->clk = 0;
        top->eval();
    }
    void step() {
        top->en = 1;
        top->clk = 0;
        top->eval();
        top->clk = 1;
        top->eval();
    }
    int getCount() { return static_cast<int>(top->debug_bus); }
};

using namespace emscripten;

EMSCRIPTEN_BINDINGS(tiny_cpu_spike) {
    class_<CounterSim<Vcounter_a>>("CounterSimA")
        .constructor<>()
        .function("reset", &CounterSim<Vcounter_a>::reset)
        .function("step", &CounterSim<Vcounter_a>::step)
        .function("getCount", &CounterSim<Vcounter_a>::getCount);
    class_<CounterSim<Vcounter_b>>("CounterSimB")
        .constructor<>()
        .function("reset", &CounterSim<Vcounter_b>::reset)
        .function("step", &CounterSim<Vcounter_b>::step)
        .function("getCount", &CounterSim<Vcounter_b>::getCount);
}
