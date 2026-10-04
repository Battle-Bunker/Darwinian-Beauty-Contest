# Python runner for Darwinian Beauty Contest programs (one flower species per team).
#   python3 py_runner.py flower | bee
# Every call forks a fresh process that runs the whole program from scratch, then calls flower(challenge),
# first() or decide(challenge, response). A flower's call, and a bee's first(), then vanish. After a bee's
# decide() returns a feed, its process is kept for one more call, fed(nectar), if the program defines it:
# the same instance, with every global it had; then it vanishes too. Nothing else survives from one call
# to the next, except a bee's MEMORY, which the engine keeps and sends with every call. `random` is
# freshly seeded on every call and `time` is available.
# The code is the program's minified form (vendor/measure.js), so names can't carry data.
#
# Globals: GAME (the game's settings) and, for a bee, MEMORY (a key-value store: str keys, str / number /
# bool / None values).
#
# Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
# {code, ms, limitMs, game, maxChars, maxResponseBytes}.
# Requests:
#   flower: {"op": "call", "c": challenge} -> {"v": [response, percent], "bytes": n, "cpu": ms} | {"e": error, "cpu": ms}
#   bee:    {"op": "first", "memory": json}  -> {"a": challenge, "out", "memory": json} | {"e", "out"}
#           {"op": "stage", "c", "r"}        -> {"ok": true}: the next decide's arguments, read in ahead of its call
#           {"op": "decide", "staged": true, "memory": json}   (or with "c" and "r" instead of "staged")
#                                            -> {"a": ["feed" | "leave", challenge], "out", "memory": json} | {"e", "out"}
#           {"op": "fed", "nectar": x}       -> {"ok": true, "out", "memory": json} | {"e", "out"} | {"skipped": true}
#   A bee's reply carries "memoryError" instead of "memory" when MEMORY isn't a plain key-value store.
#   Any request other than fed ends a kept instance.
# A flower's `cpu` is the CPU time of its forked process for the call: running the program, flower(), and
# writing the response as JSON, whose UTF-8 size (`bytes`) must be at most maxResponseBytes. Time limits are
# wall-clock: a flower is stopped at `ms`, and so is fed(); a bee's `ms` for first and decide is a deadline
# the engine keeps (a late reply still counts), so the runner only stops those at the hard limit `limitMs`.
# The engine runs at most one program per CPU core, so wall time and CPU time stay close.
# No user code runs after the clock stops: the reply and MEMORY are copied into exact built-in types, and
# the response written as JSON, inside the timed window.
# NOT a security sandbox: restricted builtins + import whitelist + timeouts + memory cap only.
import builtins, io, json, math, os, random, resource, select, signal, sys, time

ALLOWED_MODULES = {
    "math", "cmath", "random", "hashlib", "string", "itertools", "functools", "collections",
    "re", "json", "bisect", "heapq", "statistics", "fractions", "decimal", "operator", "typing",
    "dataclasses", "enum", "zlib", "struct", "binascii", "base64", "copy", "numbers", "array", "time",
}
for _m in ALLOWED_MODULES:
    __import__(_m)  # pre-import so forked calls start fast

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


MAX_DEPTH = 600  # deeper than any response may be (256 levels; a tree level is two)
SAFE_INT = 2 ** 53 - 1


def plain(v, depth=0):
    """
    A copy of v made only of the exact built-in types JSON has (dict with str keys, list, str, int, float,
    bool, None; a tuple becomes a list, an int, float, bool or None key a string). Subclasses are refused:
    their hooks (items, __iter__, __float__, __repr__, ...) could otherwise run user code after the clock
    stops. Runs inside the timed window, so the copying is the program's own compute.
    """
    if depth > MAX_DEPTH:
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


def plain_memory(m):
    """MEMORY as a plain dict of str keys to str / int / float / bool / None values (exact types only)."""
    if type(m) is not dict:
        raise NotPlain(f"MEMORY must be a dict, not a {type(m).__name__}")
    out = {}
    for k, v in dict.items(m):
        if type(k) is not str:
            raise NotPlain(f"MEMORY keys must be strings (found a {type(k).__name__} key)")
        t = type(v)
        if v is None or t is bool or t is str:
            pass
        elif t is int:
            if not -SAFE_INT <= v <= SAFE_INT:
                raise NotPlain(f"MEMORY[{k[:20]!r}] is an int beyond ±{SAFE_INT}")
        elif t is float:
            if v != v or v in (math.inf, -math.inf):
                raise NotPlain(f"MEMORY[{k[:20]!r}] is not a finite number")
        else:
            raise NotPlain(f"MEMORY[{k[:20]!r}] is a {t.__name__}: values must be str, int, float, bool or None")
        out[k] = v
    return out


def dumps(v):
    """Compact JSON text, UTF-8 as JavaScript writes it (no user code can run here: v is plain)."""
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


PROTO = os.fdopen(os.dup(1), "wb")  # protocol channel; programs' print() never reaches it


def send(line):
    PROTO.write(line if isinstance(line, bytes) else line.encode())
    PROTO.write(b"\n")
    PROTO.flush()


def reply(obj):
    send(json.dumps(obj))


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


def write_all(fd, data):
    while data:
        n = os.write(fd, data)
        data = data[n:]


def read_line(fd, seconds):
    """Read up to and including a newline from fd within `seconds`: (bytes without it, ok)."""
    chunks, deadline = [], time.monotonic() + seconds
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            return b"", False
        ready, _, _ = select.select([fd], [], [], left)
        if not ready:
            return b"", False
        b = os.read(fd, 1 << 20)
        if not b:
            return b"".join(chunks), False
        chunks.append(b)
        if b.endswith(b"\n"):
            return b"".join(chunks)[:-1], True


ENTRY = {"flower": ("flower",), "bee": ("first", "decide")}
SIGNATURE = {"flower": "flower(challenge)", "bee": "first() and decide(challenge, response)"}
KEPT_FOR_MS = 30000  # a kept bee instance waits this long for fed() at most


def main(role, setup):
    ms = setup["ms"]
    limit = setup.get("limitMs") or ms  # the hard stop for first and decide
    max_chars = setup.get("maxChars", 20000)
    max_bytes = setup.get("maxResponseBytes") or 1048576
    game = dict(setup["game"])
    state = {"staged": None, "kept": None}  # kept: (pid, reply fd, command fd) of a bee instance kept for fed

    def serve(req, budget, trial, w, cmd):
        """The forked child: run the program once, reply on w; a feed decision may then wait on cmd for fed."""
        captured = io.StringIO()
        sys.stdout = sys.stderr = captured
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        random.seed()  # fresh entropy: the forked child would otherwise repeat the parent's sequence
        die_with_parent()
        t0 = time.process_time()
        ns = {"__name__": "__program__", "__builtins__": SAFE_BUILTINS, "GAME": dict(game)}
        keep = False
        try:
            if role == "bee":
                ns["MEMORY"] = json.loads(req["memory"]) if req.get("memory") is not None else {}
            timer(budget / 1000)
            exec(code, ns)
            for name in ENTRY[role]:
                if not callable(ns.get(name)):
                    raise NameError(f"program must define {SIGNATURE[role]}")
            if trial:
                line = "{}"
            elif role == "flower":
                v = ns["flower"](req["c"])
                # Still on the clock: the reply as plain data, the response as JSON, and its size.
                try:
                    if type(v) in (list, tuple) and len(v) == 2:
                        rt, pt = dumps(plain(v[0])), dumps(plain(v[1]))
                        size = len(rt.encode("utf-8"))
                        line = None if size > max_bytes else f'{{"bytes":{size},"v":[{rt},{pt}]'
                        if line is None:
                            raise NotPlain(f"the response is {size} bytes of JSON, over the cap of {max_bytes}")
                    else:
                        line = f'{{"v":{dumps(plain(v))}'
                except NotPlain as e:
                    m = str(e)
                    line = '{"e":' + json.dumps(m if m.startswith("the response") else f"flower returned something that is not plain data ({m})")
                except UnicodeEncodeError:
                    line = '{"e":' + json.dumps("the response is not valid Unicode (a lone surrogate)")
                timer(0)
                line += f',"cpu":{(time.process_time() - t0) * 1000}}}'
            else:
                if req["op"] == "first":
                    v = ns["first"]()
                else:
                    v = ns["decide"](req["c"], req["r"])
                line, a = bee_reply(req["op"], v, ns)
                # (a is the plain copy: checking it runs no user code)
                keep = (req["op"] == "decide" and callable(ns.get("fed"))
                        and (a == "feed" or (type(a) is list and len(a) == 2 and a[0] == "feed")))
        except BaseException as e:
            timer(0)
            line = json.dumps({"e": "Timeout: took too long" if isinstance(e, Timeout) else short(e),
                               "cpu": (time.process_time() - t0) * 1000})
            keep = False
        if role == "bee" and not trial:
            line = line[:-1] + ',"out":' + json.dumps(captured.getvalue()[:2000]) + "}"
        write_all(w, (b"W" if keep else b".") + line.encode("utf-8") + b"\n")
        if not keep:
            os._exit(0)
        # Kept for fed(nectar): wait for the engine's word (or give up), then run it in this same instance.
        ready, _, _ = select.select([cmd], [], [], KEPT_FOR_MS / 1000)
        if not ready:
            os._exit(0)
        got, ok = read_line(cmd, 1)
        if not ok:
            os._exit(0)
        captured.seek(0)
        captured.truncate()
        try:
            nectar = json.loads(got)["nectar"]
            timer(ms / 1000)
            ns["fed"](nectar)
            line, _ = bee_reply("fed", None, ns)
        except BaseException as e:
            timer(0)
            line = json.dumps({"e": "Timeout: took too long" if isinstance(e, Timeout) else short(e)})
        line = line[:-1] + ',"out":' + json.dumps(captured.getvalue()[:2000]) + "}"
        write_all(w, b"." + line.encode("utf-8") + b"\n")
        os._exit(0)

    def bee_reply(op, v, ns):
        """
        Still on the clock: the reply (none for fed) and MEMORY as plain data, then the clock stops.
        Returns (the reply's JSON text, the plain reply or None).
        """
        out = {"ok": True}
        a = None
        if op != "fed":
            try:
                a = plain(v)
                if len(json.dumps(a)) > max_chars:
                    raise NotPlain(f"over {max_chars} characters")
            except NotPlain as e:
                timer(0)
                return json.dumps({"e": f"{op} returned something that is not plain data or too large ({e})"}), None
            out = {"a": a}
        try:
            memory = json.dumps(plain_memory(ns.get("MEMORY")), allow_nan=False)
            if len(memory) <= 1 << 20:
                out["memory"] = memory
            else:
                out["memoryError"] = "MEMORY is far too large"
        except NotPlain as e:
            out["memoryError"] = str(e) if str(e).startswith("MEMORY") else f"MEMORY is not plain data ({e})"
        timer(0)
        return json.dumps(out), a

    def run(req, budget, trial=False):
        """Run the program once in a forked child: its reply line (bytes)."""
        r, w = os.pipe()
        cr, cw = os.pipe() if role == "bee" else (None, None)
        pid = os.fork()
        if pid == 0:
            os.close(r)
            if cw is not None:
                os.close(cw)
            serve(req, budget, trial, w, cr)
            os._exit(0)
        os.close(w)
        if cr is not None:
            os.close(cr)
        # Wall-clock backstop for a child that ignores its timer (well before proc.js gives up on this process).
        data, ok = read_line(r, (2 * budget if role == "flower" else budget) / 1000 + 0.5)
        if ok and data[:1] == b"W":
            state["kept"] = (pid, r, cw)
            return data[1:]
        finish(pid, r, cw, ok)
        if not ok:
            return b'{"e":"Timeout: took too long","out":""}' if role == "bee" else b'{"e":"Timeout: took too long","cpu":null}'
        return data[1:]

    def finish(pid, r, cw, ok=True):
        if not ok:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        for fd in (r, cw):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass

    def drop_kept():
        if state["kept"]:
            pid, r, cw = state["kept"]
            state["kept"] = None
            finish(pid, r, cw, ok=False)

    def fed(req):
        if not state["kept"]:
            return b'{"skipped":true}'
        pid, r, cw = state["kept"]
        state["kept"] = None
        try:
            write_all(cw, json.dumps({"nectar": req.get("nectar")}).encode() + b"\n")
        except OSError:
            finish(pid, r, cw, ok=False)
            return b'{"e":"the bee crashed","out":""}'
        data, ok = read_line(r, ms / 1000 + 0.5)
        finish(pid, r, cw, ok)
        return data[1:] if ok else b'{"e":"Timeout: took too long","out":""}'

    try:
        code = compile(setup["code"], f"<{role}>", "exec")
    except SyntaxError as e:
        reply({"ok": False, "e": short(e)})
        code = None
    if code is not None:
        # A trial run checks that the program loads and defines its entry points.
        res = json.loads(run({"op": "first", "memory": None}, ms * 10, trial=True))
        if "e" in res:
            reply({"ok": False, "e": res["e"], "out": res.get("out", "")})
            code = None
        else:
            reply({"ok": True, "out": ""})
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except (ValueError, RecursionError):
            reply({"e": "unreadable request", "out": ""})
            continue
        op = req.get("op")
        if op == "fed":
            send(fed(req))
            continue
        drop_kept()
        if op == "stage":
            state["staged"] = (req.get("c"), req.get("r"))
            reply({"ok": True})
            continue
        if code is None:
            reply({"e": "the program failed to load", "cpu": 0, "out": ""})
            continue
        if op == "decide" and req.get("staged"):
            if state["staged"] is None:
                reply({"e": "the turn's arguments never arrived", "out": ""})
                continue
            req["c"], req["r"] = state["staged"]
        state["staged"] = None
        send(run(req, ms if role == "flower" else limit))


if __name__ == "__main__":
    try:
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    except (ValueError, OSError):
        pass
    main(sys.argv[1], json.loads(sys.stdin.readline()))
