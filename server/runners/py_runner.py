# Python runner for Darwinian Beauty Contest programs (one flower species per team).
#   python3 py_runner.py flower | bee
# Both run statelessly: every call forks a fresh process that runs the whole program from scratch, then
# calls flower(challenge), first() or decide(challenge, response), and vanishes. Nothing survives from one
# call to the next, except a bee's MEMORY, which the engine keeps and sends with every call. `random` is
# freshly seeded on every call and `time` is available.
# The code is the program's minified form (vendor/measure.js), so names can't carry data.
#
# Globals: GAME (the game's settings), HISTORY (the team's history: vendor/query/history.py, queried with
# its typed builder) and, for a bee, MEMORY (a JSON value).
#
# Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
# {code, ms, limitMs, game, maxChars, ledger}: `ledger` is the team's turn records so far.
# Requests:
#   {"op": "ledger", "entries": [...]}        append turn records to HISTORY (between calls, never timed)
#   flower: {"op": "call", "c": challenge}    -> {"v": [response, percent], "cpu": ms} | {"e": error, "cpu": ms}
#   bee:    {"op": "first", "memory": json}   -> {"a": challenge, "out", "memory": json} | {"e", "out"}
#           {"op": "decide", "c", "r", "memory": json}
#                                             -> {"a": ["feed" | "leave", challenge], "out", "memory": json} | {"e", "out"}
#   A bee's reply carries "memoryError" instead of "memory" when MEMORY isn't plain JSON.
# HISTORY lives in this (parent) process and is brought up to date between calls; each forked call
# inherits it, indexes included, so receiving it costs a call nothing. A flower's `cpu` is the CPU time of
# its forked process for the call: running the program, then flower(). Time limits are wall-clock: a
# flower is stopped at `ms`; a bee's `ms` is a deadline the engine keeps (a late reply still counts), so
# the runner only stops a bee call at the hard limit `limitMs`. The engine runs at most one program per
# CPU core, so wall time and CPU time stay close.
# NOT a security sandbox: restricted builtins + import whitelist + timeouts + memory cap only.
import builtins, gc, importlib.util, io, json, math, os, random, resource, select, signal, sys, time

ALLOWED_MODULES = {
    "math", "cmath", "random", "hashlib", "string", "itertools", "functools", "collections",
    "re", "json", "bisect", "heapq", "statistics", "fractions", "decimal", "operator", "typing",
    "dataclasses", "enum", "zlib", "struct", "binascii", "base64", "copy", "numbers", "array", "time",
}
for _m in ALLOWED_MODULES:
    __import__(_m)  # pre-import so forked calls start fast

_spec = importlib.util.spec_from_file_location(
    "dbc_history", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "vendor", "query", "history.py"))
history = importlib.util.module_from_spec(_spec)
sys.modules["dbc_history"] = history
_spec.loader.exec_module(history)

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


def short(e):
    return (type(e).__name__ + ": " + str(e))[:300]


class NotPlain(Exception):
    pass


def plain(v, depth=0):
    """
    A copy of v made only of the exact built-in types JSON has (dict with str keys, list, str, int, float,
    bool, None; a tuple becomes a list, an int, float, bool or None key a string). Subclasses are refused:
    their hooks (items, __iter__, __float__, __repr__, ...) could otherwise run user code after the clock
    stops. Runs inside the timed window, so the copying is the program's own compute.
    """
    if depth > 1000:
        raise NotPlain("nested too deeply")
    t = type(v)
    if v is None or t is bool or t is str or t is int:
        return v
    if t is float:
        if v != v or v in (math.inf, -math.inf):
            raise NotPlain("not a finite number")
        return v
    if t is list or t is tuple:
        return [plain(x, depth + 1) for x in v]
    if t is dict:
        out = {}
        for k, x in dict.items(v):
            tk = type(k)
            if tk is not str:
                if k is None or tk is bool or tk is int or tk is float:
                    k = json.dumps(plain(k))
                else:
                    raise NotPlain(f"a {tk.__name__} key")
            out[k] = plain(x, depth + 1)
        return out
    raise NotPlain(f"a {t.__name__}")


def encode(v, max_chars):
    """JSON text of a plain() value: no user code can run here."""
    s = json.dumps(v, allow_nan=False)
    if len(s) > max_chars:
        return None, f"too large (over {max_chars} characters)"
    return s, None


PROTO = os.fdopen(os.dup(1), "w")  # protocol channel; programs' print() never reaches it


def reply(obj):
    PROTO.write(json.dumps(obj) + "\n")
    PROTO.flush()


try:
    import ctypes
    _LIBC = ctypes.CDLL(None)
except Exception:
    _LIBC = None


def die_with_parent():
    """A forked call is killed if this runner dies (proc.js also kills the runner's whole process group).
    (Not RLIMIT_CPU: setting it makes CPU-time accounting coarse on some kernels.)"""
    try:
        _LIBC.prctl(1, signal.SIGKILL)  # PR_SET_PDEATHSIG
        if os.getppid() == 1:
            os._exit(1)
    except Exception:
        pass


ENTRY = {"flower": ("flower",), "bee": ("first", "decide")}
SIGNATURE = {"flower": "flower(challenge)", "bee": "first() and decide(challenge, response)"}


def main(role, setup):
    ms = setup["ms"]
    limit = setup.get("limitMs") or ms  # the hard stop per call
    max_chars = setup.get("maxChars", 20000)
    game = dict(setup["game"])
    hist = history.local(setup.get("ledger") or [], game.get("team"))
    gc.freeze()  # HISTORY lives in the permanent generation: a forked call's GC never walks it

    def run(req, budget, trial=False):
        """Run the program once in a forked child: (reply, child's output)."""
        r, w = os.pipe()
        pid = os.fork()
        if pid == 0:
            os.close(r)
            captured = io.StringIO()
            sys.stdout = sys.stderr = captured
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 1)
            os.dup2(devnull, 2)
            random.seed()  # fresh entropy: the forked child would otherwise repeat the parent's sequence
            die_with_parent()
            t0 = time.process_time()
            out = {}
            ns = {"__name__": "__program__", "__builtins__": SAFE_BUILTINS, "GAME": dict(game), "HISTORY": hist.history}
            try:
                if role == "bee":
                    ns["MEMORY"] = json.loads(req["memory"]) if req.get("memory") is not None else {}
                timer(budget / 1000)
                exec(code, ns)
                for name in ENTRY[role]:
                    if not callable(ns.get(name)):
                        raise NameError(f"program must define {SIGNATURE[role]}")
                if trial:
                    v = None
                elif role == "flower":
                    v = ns["flower"](req["c"])
                elif req["op"] == "first":
                    v = ns["first"]()
                else:
                    v = ns["decide"](req["c"], req["r"])
                # Still on the clock: the reply (and a bee's MEMORY) as plain data.
                what = "flower" if role == "flower" else req["op"]
                try:
                    v, err = plain(v), None
                except NotPlain as e:
                    v, err = None, f"{what} returned something that is not plain data ({e})"
                memory = memory_error = None
                if role == "bee" and err is None:
                    try:
                        memory = plain(ns.get("MEMORY"))
                    except NotPlain as e:
                        memory_error = f"MEMORY is not plain data ({e})"
                timer(0)
                cpu = (time.process_time() - t0) * 1000
                if err:
                    out = {"e": err}
                else:
                    s, err = encode(v, max_chars)
                    out = {"e": f"{what} returned something " + err} if err else {"v": s}
                    if role == "bee" and not err:
                        if memory_error:
                            out["memoryError"] = memory_error
                        else:
                            m, merr = encode(memory, 1 << 20)
                            out.update({"memory": m} if m is not None else {"memoryError": "MEMORY is " + merr})
                out["cpu"] = cpu
            except BaseException as e:
                timer(0)
                out = {"e": "Timeout: took too long" if isinstance(e, Timeout) else short(e), "cpu": (time.process_time() - t0) * 1000}
            out["out"] = captured.getvalue()[:2000]
            data = json.dumps(out).encode()
            while data:
                n = os.write(w, data)
                data = data[n:]
            os._exit(0)
        os.close(w)
        # Wall-clock backstop for a child that ignores its timer (well before proc.js gives up on this process).
        chunks, deadline_s, ok = [], (2 * budget if role == "flower" else budget) / 1000 + 0.5, True
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
            return {"e": "Timeout: took too long", "cpu": None, "out": ""}
        try:
            return json.loads(b"".join(chunks) or b"{}")
        except ValueError:
            return {"e": "the program crashed", "cpu": None, "out": ""}

    try:
        code = compile(setup["code"], f"<{role}>", "exec")
    except SyntaxError as e:
        reply({"ok": False, "e": short(e)})
        code = None
    if code is not None:
        # A trial run checks that the program loads and defines its entry points.
        res = run({"op": "first", "memory": None}, ms * 10, trial=True)
        if "e" in res:
            reply({"ok": False, "e": res["e"], "out": res.get("out", "")})
            code = None
        else:
            reply({"ok": True, "out": res.get("out", "")})
    for line in sys.stdin:
        req = json.loads(line)
        if req.get("op") == "ledger":
            hist.append(req["entries"])
            gc.freeze()
            reply({"ok": True})
            continue
        if code is None:
            reply({"e": "the program failed to load", "cpu": 0, "out": ""})
            continue
        res = run(req, ms if role == "flower" else limit)
        if role == "flower":
            reply({"v": json.loads(res["v"]), "cpu": res.get("cpu")} if "v" in res else {"e": res.get("e", "flower crashed"), "cpu": res.get("cpu")})
        elif "v" in res:
            out = {"a": json.loads(res["v"]), "out": res.get("out", "")}
            for k in ("memory", "memoryError"):
                if k in res:
                    out[k] = res[k]
            reply(out)
        else:
            reply({"e": res.get("e", "the bee crashed"), "out": res.get("out", "")})


if __name__ == "__main__":
    try:
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    except (ValueError, OSError):
        pass
    main(sys.argv[1], json.loads(sys.stdin.readline()))
