# Python runner for Darwinian Beauty Contest programs (one flower per team).
#   python3 py_runner.py flower   - stateless: every call forks a fresh process that runs the whole
#                                   program from scratch, then calls flower(challenge, ledger).
#                                   `random` is freshly seeded on every call and `time` is available,
#                                   so a flower can run an anytime search until its budget is nearly spent.
#   python3 py_runner.py bee      - stateful: module globals persist between calls for as long as this
#                                   version of the bee plays (until its team submits a new bee, or it
#                                   crashes). `random` is seeded once, freshly, at the start.
# The code is the program's minified form (vendor/measure.js), so names can't carry data.
#
# Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
# {code, ms, limitMs, game, maxChars, ledger}: `ledger` is the team ledger so far (a list of entries).
# Requests:
#   {"op": "ledger", "entries": [...]}   append to the team ledger (between calls, never timed)
#   flower: {"op": "call", "c": challenge} -> {"v": the return value, "cpu": ms} | {"e": error, "cpu": ms}
#   bee:    {"op": "first"}                -> {"a": first(ledger), "out": printed}
#           {"op": "decide", "c", "r"}     -> {"a": decide(c, r, ledger), "out": printed}
# A flower's `cpu` is the CPU time of its forked process for the call: running the program, then
# flower(). The ledger is already in memory when the call starts (the fork inherits it), so receiving it
# costs nothing; reading it is the flower's own compute. Time limits are wall-clock: a flower is stopped
# at `ms`; a bee's `ms` is a deadline the engine keeps (a late reply still counts for the next turn), so
# the runner only stops a bee call at the hard limit `limitMs`. The engine runs at most one program per
# CPU core, so wall time and CPU time stay close.
# NOT a security sandbox: restricted builtins + import whitelist + timeouts + memory cap only.
import builtins, gc, inspect, io, json, os, random, resource, select, signal, sys, time

ALLOWED_MODULES = {
    "math", "cmath", "random", "hashlib", "string", "itertools", "functools", "collections",
    "re", "json", "bisect", "heapq", "statistics", "fractions", "decimal", "operator", "typing",
    "dataclasses", "enum", "zlib", "struct", "binascii", "base64", "copy", "numbers", "array", "time",
}
for _m in ALLOWED_MODULES:
    __import__(_m)  # pre-import so forked flowers start fast

_real_import = builtins.__import__


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0 or name.split(".")[0] not in ALLOWED_MODULES:
        raise ImportError(f"module '{name}' is not allowed in this game")
    return _real_import(name, globals, locals, fromlist, level)


SAFE_BUILTINS = {k: v for k, v in vars(builtins).items()
                 if k not in {"open", "input", "breakpoint", "exit", "quit", "help", "__import__", "__loader__", "__spec__"}}
SAFE_BUILTINS["__import__"] = _safe_import


class Timeout(BaseException):
    pass


def _alarm(*_):
    raise Timeout("took too long")


signal.signal(signal.SIGALRM, _alarm)


def timer(seconds):
    signal.setitimer(signal.ITIMER_REAL, seconds)


# ---------- shared ----------

def fresh_namespace(game):
    return {"__name__": "__program__", "__builtins__": SAFE_BUILTINS, "GAME": dict(game)}


def short(e):
    return (type(e).__name__ + ": " + str(e))[:300]


def encode(v, max_chars):
    if isinstance(v, tuple):
        v = list(v)
    try:
        s = json.dumps(v, allow_nan=False)
    except (TypeError, ValueError) as e:
        return None, "not plain data: " + short(e)
    if len(s) > max_chars:
        return None, f"too large (over {max_chars} characters)"
    return s, None


def call_with(fn, args):
    """Call fn with as many of args as it takes: the ledger (the last argument) is optional."""
    try:
        params = list(inspect.signature(fn).parameters.values())
    except (TypeError, ValueError):
        return fn(*args)
    if any(p.kind == p.VAR_POSITIONAL for p in params):
        return fn(*args)
    n = sum(p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) for p in params)
    return fn(*args[:max(n, len(args) - 1)]) if n < len(args) else fn(*args)


PROTO = os.fdopen(os.dup(1), "w")  # protocol channel; programs' print() never reaches it


def reply(obj):
    PROTO.write(json.dumps(obj) + "\n")
    PROTO.flush()


# ---------- flower ----------

def run_flower(setup):
    ms = setup["ms"]
    max_chars = setup.get("maxChars", 20000)
    ledger = list(setup.get("ledger") or [])
    gc.freeze()  # the ledger lives in the permanent generation: a forked flower's GC never walks it
    try:
        code = compile(setup["code"], "<flower>", "exec")
        reply({"ok": True})
    except SyntaxError as e:
        reply({"ok": False, "e": short(e)})
        code = None
    for line in sys.stdin:
        req = json.loads(line)
        if req.get("op") == "ledger":
            ledger.extend(req["entries"])
            gc.freeze()
            reply({"ok": True})
            continue
        if code is None:
            reply({"e": "flower failed to load", "cpu": 0})
            continue
        r, w = os.pipe()
        pid = os.fork()
        if pid == 0:  # child: run the whole program fresh, answer once, vanish
            os.close(r)
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 1)
            os.dup2(devnull, 2)
            random.seed()  # fresh entropy: the forked child would otherwise repeat the parent's sequence
            t0 = time.process_time()
            try:
                timer(ms / 1000)
                ns = fresh_namespace(setup["game"])
                exec(code, ns)
                fn = ns.get("flower")
                if not callable(fn):
                    raise NameError("program must define flower(challenge, ledger)")
                v = call_with(fn, (req["c"], ledger))
                timer(0)
                cpu = (time.process_time() - t0) * 1000
                s, err = encode(v, max_chars)
                out = {"e": "flower returned something " + err, "cpu": cpu} if err else {"v": s, "cpu": cpu}
            except BaseException as e:
                timer(0)
                out = {"e": "Timeout: took too long" if isinstance(e, Timeout) else short(e), "cpu": (time.process_time() - t0) * 1000}
            data = json.dumps(out).encode()
            while data:
                n = os.write(w, data)
                data = data[n:]
            os._exit(0)
        os.close(w)
        # Wall-clock backstop for a child that ignores its timer (the engine keeps the machine from being
        # oversubscribed, so CPU time and wall time stay close).
        chunks, deadline_s = [], 2 * ms / 1000 + 0.5
        ok = True
        while True:
            ready, _, _ = select.select([r], [], [], deadline_s)
            if not ready:
                ok = False
                break
            b = os.read(r, 1 << 20)
            if not b:
                break
            chunks.append(b)
        os.close(r)
        if not ok:
            os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        if not ok:
            reply({"e": "Timeout: took too long", "cpu": None})
            continue
        try:
            out = json.loads(b"".join(chunks) or b"{}")
        except ValueError:
            out = {}
        if "v" in out:
            reply({"v": json.loads(out["v"]), "cpu": out.get("cpu")})
        else:
            reply({"e": out.get("e", "flower crashed"), "cpu": out.get("cpu")})


# ---------- bee ----------

def run_bee(setup):
    ms = setup["ms"]
    limit = setup.get("limitMs") or ms  # the hard stop per call
    max_chars = setup.get("maxChars", 20000)
    ledger = list(setup.get("ledger") or [])
    random.seed()
    ns = fresh_namespace(setup["game"])
    captured = io.StringIO()
    sys.stdout = captured
    sys.stderr = captured

    def take_output():
        s = captured.getvalue()
        captured.seek(0)
        captured.truncate()
        return s[:2000]

    def timed(fn, *args, budget=limit):
        timer(budget / 1000)
        try:
            return fn(*args)
        finally:
            timer(0)

    try:
        timed(lambda: exec(compile(setup["code"], "<bee>", "exec"), ns), budget=ms * 10)
        for name in ("first", "decide"):
            if not callable(ns.get(name)):
                raise NameError("program must define first(ledger) and decide(challenge, response, ledger)")
        reply({"ok": True, "out": take_output()})
    except BaseException as e:
        reply({"ok": False, "e": short(e), "out": take_output()})
        return
    for line in sys.stdin:
        req = json.loads(line)
        op = req.get("op")
        if op == "ledger":
            ledger.extend(req["entries"])
            reply({"ok": True})
            continue
        try:
            if op == "first":
                a = timed(call_with, ns["first"], (ledger,))
            elif op == "decide":
                a = timed(call_with, ns["decide"], (req["c"], req["r"], ledger))
            else:
                raise ValueError("unknown request")
            s, err = encode(a, max_chars)
            reply({"e": f"{op} returned something " + err, "out": take_output()} if err else {"a": json.loads(s), "out": take_output()})
        except Timeout:
            reply({"e": "Timeout: took too long", "out": take_output()})
        except BaseException as e:
            reply({"e": short(e), "out": take_output()})


if __name__ == "__main__":
    try:
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    except (ValueError, OSError):
        pass
    setup = json.loads(sys.stdin.readline())
    (run_flower if sys.argv[1] == "flower" else run_bee)(setup)
