# Python runner for Darwinian Beauty Contest programs.
#   python3 py_runner.py flower   — stateless: every call forks a fresh process that runs the
#                                   whole program from scratch, then calls flower(challenge).
#                                   `random` is freshly seeded on every call and `time` is
#                                   available, so a flower can run an anytime search until its
#                                   budget (GAME["ms"]) is nearly spent.
#   python3 py_runner.py bee      — stateful: module globals persist between calls for as long as
#                                   this version of the bee plays (until its team submits a new bee,
#                                   or it crashes). `random` is seeded once, freshly, at the start.
# The code is the program's minified form (vendor/measure.js), so names can't carry data.
# Protocol: JSON lines on stdin/stdout. First line is the setup {code, ms, game, maxChars}.
# Compute budgets are wall-clock time per call. The engine runs at most one program per CPU core, so
# wall time is effectively CPU time. (CPU-time timers, ITIMER_PROF, fire late on tickless kernels.)
# NOT a security sandbox: restricted builtins + import whitelist + timeouts + memory cap only.
import builtins, inspect, io, json, os, random, resource, select, signal, sys

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


def cpu_timer(seconds):
    signal.setitimer(signal.ITIMER_REAL, seconds)


# ---------- shared ----------

def fresh_namespace(game):
    return {"__name__": "__program__", "__builtins__": SAFE_BUILTINS, "GAME": dict(game)}


def short(e):
    return (type(e).__name__ + ": " + str(e))[:300]


def encode(v, max_chars):
    try:
        s = json.dumps(v, allow_nan=False)
    except (TypeError, ValueError) as e:
        return None, "response is not plain data: " + short(e)
    if len(s) > max_chars:
        return None, f"response too large (over {max_chars} characters)"
    return s, None


PROTO = os.fdopen(os.dup(1), "w")  # protocol channel; programs' print() never reaches it


def reply(obj):
    PROTO.write(json.dumps(obj) + "\n")
    PROTO.flush()


def run_flower(setup):
    ms = setup["ms"]
    max_chars = setup.get("maxChars", 20000)
    try:
        code = compile(setup["code"], "<flower>", "exec")
        reply({"ok": True})
    except SyntaxError as e:
        reply({"ok": False, "e": short(e)})
        code = None
    for line in sys.stdin:
        req = json.loads(line)
        if code is None:
            reply({"e": "flower failed to load"})
            continue
        r, w = os.pipe()
        pid = os.fork()
        if pid == 0:  # child: run the whole program fresh, answer once, vanish
            os.close(r)
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 1)
            os.dup2(devnull, 2)
            out = {}
            try:
                random.seed()  # fresh entropy: the forked child would otherwise repeat the parent's sequence
                cpu_timer(ms / 1000)
                ns = fresh_namespace(setup["game"])
                exec(code, ns)
                fn = ns.get("flower")
                if not callable(fn):
                    raise NameError("program must define flower(challenge)")
                v = fn(req["c"])
                cpu_timer(0)
                s, err = encode(v, max_chars)
                out = {"e": err} if err else {"v": s}
            except BaseException as e:
                cpu_timer(0)
                out = {"e": short(e)}
            data = json.dumps(out).encode()
            while data:
                n = os.write(w, data)
                data = data[n:]
            os._exit(0)
        os.close(w)
        # Wall-clock backstop for a child that ignores its CPU timer (the engine keeps the machine
        # from being oversubscribed, so CPU time and wall time stay close).
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
            reply({"e": "Timeout: took too long"})
            continue
        try:
            out = json.loads(b"".join(chunks) or b"{}")
        except ValueError:
            out = {}
        if "v" in out:
            reply({"v": json.loads(out["v"])})
        else:
            reply({"e": out.get("e", "flower crashed")})


def takes_visit(fn):
    """forage(seen, visit): the second argument is optional, for bees that want it."""
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return False
    if any(p.kind == p.VAR_POSITIONAL for p in params):
        return True
    return sum(p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) for p in params) >= 2


def run_bee(setup):
    ms = setup["ms"]
    max_chars = setup.get("maxChars", 20000)
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

    def timed(fn, *args, budget=ms):
        cpu_timer(budget / 1000)
        try:
            return fn(*args)
        finally:
            cpu_timer(0)

    try:
        timed(lambda: exec(compile(setup["code"], "<bee>", "exec"), ns), budget=ms * 10)
        if not callable(ns.get("forage")):
            raise NameError("program must define forage(seen, visit)")
        reply({"ok": True, "out": take_output()})
    except BaseException as e:
        reply({"ok": False, "e": short(e), "out": take_output()})
        return
    seen = []
    for line in sys.stdin:
        req = json.loads(line)
        try:
            if req["op"] == "forage":
                if req.get("new"):
                    seen = []
                if req.get("step") is not None:
                    seen.append(req["step"])
                fn = ns["forage"]
                args = (list(seen),) + ((dict(req["visit"]),) if takes_visit(fn) else ())
                a = timed(fn, *args)
                if isinstance(a, tuple):
                    a = list(a)
                s, err = encode(a, max_chars)
                reply({"e": "forage returned " + err, "out": take_output()} if err else {"a": json.loads(s), "out": take_output()})
            elif req["op"] == "tasted":
                fn = ns.get("tasted")
                if callable(fn):
                    timed(fn, list(seen), req["nectar"])
                reply({"ok": True, "out": take_output()})
        except BaseException as e:
            reply({"e": short(e), "out": take_output()})


if __name__ == "__main__":
    try:
        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    except (ValueError, OSError):
        pass
    setup = json.loads(sys.stdin.readline())
    (run_flower if sys.argv[1] == "flower" else run_bee)(setup)
