#!/usr/bin/env python3
"""
Fuel metering (wasmtime): is a WebAssembly call's fuel identical from run to run, idle or loaded, and what
does metering cost? The same C source (work.c) runs natively and as wasm.

    fuel_bench.py OUT.jsonl WASM SO [--tag T] [--reps 20] [--n 6000000]

Needs the `wasmtime` package on sys.path (pip install --target DIR wasmtime; PYTHONPATH=DIR).
Each line: {tag, mode: native | wasm | wasm_fuel | limit, rep, cpu_ms, fuel, result}.
"limit" runs give the call exactly its measured fuel, then one unit less: the first completes, the second
traps (a fuel limit is exact, whatever the machine is doing).
"""
import ctypes, json, sys, time

import wasmtime as W


def fuel_api(store):
    """(set(n), left()) across wasmtime-py versions."""
    if hasattr(store, "set_fuel"):
        return store.set_fuel, store.get_fuel
    total = [0]

    def add(n):
        store.add_fuel(n)
        total[0] += n

    return add, lambda: total[0] - store.fuel_consumed()


def main():
    out, wasm, so = sys.argv[1:4]
    opt = {"tag": "", "reps": "20", "n": "6000000"}
    rest = sys.argv[4:]
    for i in range(0, len(rest), 2):
        opt[rest[i][2:]] = rest[i + 1]
    n, reps = int(opt["n"]), int(opt["reps"])
    pt = time.process_time_ns
    lib = ctypes.CDLL(so)
    lib.work.restype, lib.work.argtypes = ctypes.c_uint64, [ctypes.c_uint32]

    def instance(fuel):
        cfg = W.Config()
        cfg.consume_fuel = fuel
        eng = W.Engine(cfg)
        mod = W.Module.from_file(eng, wasm)
        return eng, mod

    plain, metered = instance(False), instance(True)

    def run(eng_mod, fuel=None):
        eng, mod = eng_mod
        store = W.Store(eng)
        setf = left = None
        if fuel is not None:
            setf, left = fuel_api(store)
            setf(fuel)
        inst = W.Instance(store, mod, [])
        f = inst.exports(store)["work"]
        t = pt()
        try:
            r = f(store, n)
            err = None
        except Exception as e:  # a trap: out of fuel
            r, err = None, str(e).split("\n")[0][:120]
        cpu = (pt() - t) / 1e6
        used = (fuel - left()) if fuel is not None else None
        return r, cpu, used, err

    run(plain)
    run(metered, 10**15)
    with open(out, "a") as fo:
        w = lambda d: fo.write(json.dumps({"tag": opt["tag"], **d}) + "\n")
        for rep in range(reps):
            t = pt()
            r = lib.work(n)
            w({"mode": "native", "rep": rep, "cpu_ms": (pt() - t) / 1e6, "result": str(r)})
            r, cpu, _, _ = run(plain)
            w({"mode": "wasm", "rep": rep, "cpu_ms": cpu, "result": str(r)})
            r, cpu, used, _ = run(metered, 10**15)
            w({"mode": "wasm_fuel", "rep": rep, "cpu_ms": cpu, "fuel": used, "result": str(r)})
        _, _, need, _ = run(metered, 10**15)
        for give in (need, need - 1):
            r, cpu, used, err = run(metered, give)
            w({"mode": "limit", "given": give, "cpu_ms": cpu, "fuel": used, "result": None if r is None else str(r), "error": err})


if __name__ == "__main__":
    main()
