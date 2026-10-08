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
# bool / None values). Imports give module views (public names only), and `time` is the game's clock
# (game_clock): every call's clock reads 0 as its time starts, as if at the Unix epoch, so a program can time
# its own work but learns nothing of the world's time or the game's progress.
#
# Protocol: JSON lines on stdin/stdout, one reply per request, in order. The first line is the setup
# {code, ms, limitMs, game, maxChars, maxResponseBytes}.
# Requests:
#   flower: {"op": "call", "c": challenge, "ms": R} -> {"v": [response, percent], "bytes": n, "cpu": ms} | {"e": error, "cpu": ms}
#           R is the call's hidden time budget: its hard limit, and GAME["ms"] for the call (default: setup ms)
#   bee:    {"op": "first", "memory": json}  -> {"a": challenge, "out", "memory": json} | {"e", "out"}
#           {"op": "stage", "c", "r"}        -> {"ok": true}: the next decide's arguments, read in ahead of its call
#           {"op": "decide", "staged": true, "memory": json}   (or with "c" and "r" instead of "staged")
#                                            -> {"a": ["feed" | "leave", challenge], "out", "memory": json} | {"e", "out"}
#           {"op": "fed", "nectar": x}       -> {"ok": true, "a"?: challenge, "out", "memory": json} | {"e", "out"} | {"skipped": true}
#           "a" only when fed returned something other than None (the next challenge, for the engine to check);
#           "aError" instead when that isn't plain data or is too large (MEMORY is still saved)
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
import builtins, importlib, io, json, math, os, random, resource, select, signal, struct, sys, time, types
import py_rules  # (this directory)
import ctypes

ALLOWED_MODULES = {
    "math", "cmath", "random", "hashlib", "string", "itertools", "functools", "collections",
    "re", "json", "bisect", "heapq", "statistics", "fractions", "decimal", "operator", "typing",
    "dataclasses", "enum", "zlib", "struct", "binascii", "base64", "copy", "numbers", "array", "time",
}
for _m in ALLOWED_MODULES:
    __import__(_m)  # pre-import so forked calls start fast

_real_import = builtins.__import__


def _view(mod):
    """
    What a program gets for a module: a module object with its public names only. Names that start with an
    underscore, and other modules a module happens to hold (random._os, statistics.sys, dataclasses.builtins,
    ...), are left out; its own public submodules (collections.abc, json.decoder) are views too.
    """
    v = types.ModuleType(mod.__name__, mod.__doc__)
    for k, x in list(vars(mod).items()):
        if k.startswith("_"):
            continue
        if isinstance(x, types.ModuleType):
            if x.__name__ == f"{mod.__name__}.{k}":
                setattr(v, k, _view_of(x.__name__))
            continue
        setattr(v, k, x)
    return v


_VIEWS = {}


def _view_of(name):
    if name not in _VIEWS:
        _VIEWS[name] = None  # (a module that holds itself)
        _VIEWS[name] = _view(importlib.import_module(name))
        parent, _, child = name.rpartition(".")
        if parent and _VIEWS.get(parent) is not None:
            setattr(_VIEWS[parent], child, _VIEWS[name])
    return _VIEWS[name]


# The game's `time` module for the call in progress (made in the forked child as its time starts).
_CLOCK = {"module": None}


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    parts = name.split(".")
    if level != 0 or parts[0] not in ALLOWED_MODULES or any(p.startswith("_") for p in parts):
        raise ImportError(f"module '{name}' is not allowed in this game")
    if parts[0] == "time":
        if len(parts) > 1:
            raise ImportError(f"module '{name}' is not allowed in this game")
        return _CLOCK["module"]
    try:
        target = _view_of(name)
    except ImportError:
        raise ImportError(f"module '{name}' is not allowed in this game") from None
    return target if fromlist else _view_of(parts[0])


for _m in ALLOWED_MODULES - {"time"}:
    _view_of(_m)  # made once, before any fork


def game_clock():
    """
    The `time` module a program gets: the time since its call started, as if the call began at the Unix
    epoch, at real speed and full resolution; CPU time since the call started; and the calendar functions
    on that clock (UTC). Returns (module, start): start() sets the clock to zero, as each call's time starts.
    """
    pc, pc_ns = time.perf_counter, time.perf_counter_ns
    pt, pt_ns, tt, tt_ns = time.process_time, time.process_time_ns, time.thread_time, time.thread_time_ns
    zero = [0.0, 0, 0.0, 0, 0.0, 0]  # perf s, perf ns, process s, process ns, thread s, thread ns

    def start():
        zero[:] = [pc(), pc_ns(), pt(), pt_ns(), tt(), tt_ns()]

    def now():
        return pc() - zero[0]

    def now_ns():
        return pc_ns() - zero[1]

    def process_time():
        return pt() - zero[2]

    def process_time_ns():
        return pt_ns() - zero[3]

    def thread_time():
        return tt() - zero[4]

    def thread_time_ns():
        return tt_ns() - zero[5]

    cpu = {getattr(time, "CLOCK_PROCESS_CPUTIME_ID", -1): (process_time, process_time_ns),
           getattr(time, "CLOCK_THREAD_CPUTIME_ID", -2): (thread_time, thread_time_ns)}

    def clock_gettime(clk_id):
        return cpu.get(clk_id, (now, now_ns))[0]()

    def clock_gettime_ns(clk_id):
        return cpu.get(clk_id, (now, now_ns))[1]()

    def clock_getres(clk_id):
        return 1e-09

    def gmtime(secs=None):
        return time.gmtime(now() if secs is None else secs)

    def localtime(secs=None):
        return time.gmtime(now() if secs is None else secs)  # the game's clock is UTC

    def ctime(secs=None):
        return time.asctime(gmtime(secs))

    def asctime(t=None):
        return time.asctime(gmtime() if t is None else t)

    def strftime(fmt, t=None):
        return time.strftime(fmt, gmtime() if t is None else t)

    def sleep(secs):
        """Returns at once: there is nothing to wait for (limits are CPU time; waiting earns nothing)."""
        if type(secs) not in (int, float):
            raise TypeError(f"'{type(secs).__name__}' object cannot be interpreted as a number of seconds")
        if not secs >= 0:
            raise ValueError("sleep length must be non-negative")

    def get_clock_info(name):
        if name in ("process_time", "thread_time"):
            return time.get_clock_info(name)
        if name not in ("time", "monotonic", "perf_counter"):
            raise ValueError("unknown clock")
        return types.SimpleNamespace(implementation="the game's clock: time since the call started", monotonic=True,
                                     adjustable=False, resolution=1e-09)

    m = types.ModuleType("time", "The game's clock: the time since this call started, as if it began at the Unix epoch.")
    for name, fn in [("time", now), ("time_ns", now_ns), ("monotonic", now), ("monotonic_ns", now_ns),
                     ("perf_counter", now), ("perf_counter_ns", now_ns), ("process_time", process_time),
                     ("process_time_ns", process_time_ns), ("thread_time", thread_time), ("thread_time_ns", thread_time_ns),
                     ("clock_gettime", clock_gettime), ("clock_gettime_ns", clock_gettime_ns), ("clock_getres", clock_getres),
                     ("gmtime", gmtime), ("localtime", localtime), ("ctime", ctime), ("asctime", asctime),
                     ("strftime", strftime), ("mktime", time.mktime), ("strptime", time.strptime), ("sleep", sleep),
                     ("get_clock_info", get_clock_info)]:
        if callable(fn) and getattr(fn, "__module__", None) == __name__:
            fn.__name__ = fn.__qualname__ = name
        setattr(m, name, fn)
    m.struct_time = time.struct_time
    for k in dir(time):
        if k.startswith("CLOCK_"):
            setattr(m, k, getattr(time, k))
    m.timezone, m.altzone, m.daylight, m.tzname = 0, 0, 0, ("UTC", "UTC")
    start()
    return m, start


# Introspection guards (py_rules.py has the static half): getattr, setattr, delattr, hasattr and dir refuse
# dunder attributes and the interpreter's internals, and str.format reached by name; eval, exec, compile,
# globals, locals, vars, open and the like are gone. Best effort: not a security sandbox.
_real_getattr, _real_setattr, _real_delattr, _real_hasattr, _real_dir = getattr, setattr, delattr, hasattr, dir


def _refused(obj, name):
    if type(name) is not str:
        return None  # the real function raises its own TypeError
    why = py_rules.refused_attr(name)
    if why:
        return why
    if name in ("format", "format_map") and (isinstance(obj, str) or (isinstance(obj, type) and issubclass(obj, str))):
        return f"str.{name} only on a literal string (use an f-string)"
    return None


def _guard(obj, name):
    why = _refused(obj, name)
    if why:
        raise AttributeError(why)


def _getattr(obj, name, *default):
    _guard(obj, name)
    return _real_getattr(obj, name, *default)


def _setattr(obj, name, value):
    _guard(obj, name)
    return _real_setattr(obj, name, value)


def _delattr(obj, name):
    _guard(obj, name)
    return _real_delattr(obj, name)


def _hasattr(obj, name):
    _guard(obj, name)
    return _real_hasattr(obj, name)


def _dir(*args):
    names = _real_dir(*args) if args else sorted(sys._getframe(1).f_locals)
    return [n for n in names if not py_rules.refused_attr(n)]


def _gone(name):
    def gone(*args, **kwargs):
        raise NameError(f"{name}() is not available in this game")
    gone.__name__ = gone.__qualname__ = name
    return gone


SAFE_BUILTINS = {k: v for k, v in vars(builtins).items()
                 if k not in {"open", "input", "breakpoint", "exit", "quit", "help", "__import__", "__loader__", "__spec__",
                              "license", "credits", "copyright"} | py_rules.GONE}
SAFE_BUILTINS.update({"__import__": _safe_import, "getattr": _getattr, "setattr": _setattr, "delattr": _delattr,
                      "hasattr": _hasattr, "dir": _dir})
for _name in py_rules.GONE:
    SAFE_BUILTINS[_name] = _gone(_name)
for _f, _name in ((_getattr, "getattr"), (_setattr, "setattr"), (_delattr, "delattr"), (_hasattr, "hasattr"), (_dir, "dir")):
    _f.__name__ = _f.__qualname__ = _name


def _attrgetter(*names):
    for n in names:
        for part in (n.split(".") if type(n) is str else ()):
            _guard("", part)
    return _operator.attrgetter(*names)


def _methodcaller(name, *args, **kwargs):
    _guard("", name)
    return _operator.methodcaller(name, *args, **kwargs)


import operator as _operator
_VIEWS["operator"].attrgetter, _VIEWS["operator"].methodcaller = _attrgetter, _methodcaller
_attrgetter.__name__, _methodcaller.__name__ = "attrgetter", "methodcaller"
for _mod, _names in (("string", ("Formatter",)), ("typing", ("get_type_hints", "ForwardRef"))):
    for _name in _names:  # they look attributes up by name, or evaluate strings as code
        if hasattr(_VIEWS[_mod], _name):
            delattr(_VIEWS[_mod], _name)


class Timeout(BaseException):
    pass


# CPU-time budgets (docs/research/compute-budgets/REPORT.md §4.2). A call's budget is CPU time on the forked
# child's own thread clock (exact, and it leaves out host steal): the call is stopped when it has used it.
#   graceful: ITIMER_REAL (an hrtimer, so it fires on time) armed for the CPU still left, and re-armed until
#             the thread clock reaches the budget; then Timeout is raised in the program (at most ~0.1 ms past it)
#   hard:     a POSIX timer on CLOCK_THREAD_CPUTIME_ID that has the kernel SIGKILL the child at budget + 5 ms of
#             CPU, so a long C call (or a program that swallows Timeout) is stopped too (tick precision: ≤ ~9 ms)
# No ITIMER_PROF, ITIMER_VIRTUAL or process-clock timers: they would make process_time() tick-stale.
HARD_GRACE_NS = 5_000_000
SLACK_NS = 20_000


class _Itimerspec(ctypes.Structure):
    _fields_ = [("it_interval_s", ctypes.c_long), ("it_interval_ns", ctypes.c_long),
                ("it_value_s", ctypes.c_long), ("it_value_ns", ctypes.c_long)]


def _thread_cpu_killer():
    """(arm(ns) -> timer, disarm(timer)): SIGKILL after ns of this thread's CPU. Resolved before any fork; None
    if the C library can't (then the parent's wall backstop is the only hard stop)."""
    try:
        librt = ctypes.CDLL("librt.so.1", use_errno=True)
        create, settime, delete = librt.timer_create, librt.timer_settime, librt.timer_delete
        create.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
        settime.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p]
        delete.argtypes = [ctypes.c_void_p]
        sev = ctypes.create_string_buffer(64)  # struct sigevent: sigev_value, sigev_signo, sigev_notify (SIGEV_SIGNAL)
        struct.pack_into("qii", sev, 0, 0, signal.SIGKILL, 0)
        clock = time.CLOCK_THREAD_CPUTIME_ID

        def arm(ns):
            tid = ctypes.c_void_p()
            if create(clock, sev, ctypes.byref(tid)) != 0:
                return None
            settime(tid, 0, ctypes.byref(_Itimerspec(0, 0, ns // 1_000_000_000, ns % 1_000_000_000)), None)
            return tid

        def disarm(tid):
            delete(tid)

        disarm(arm(10 ** 12))  # works here
        return arm, disarm
    except Exception:
        return None


_KILLER = _thread_cpu_killer()


class _Guard:
    """The budget of the call in progress (in a forked child)."""

    def __init__(self):
        self.armed, self.cpu, self.killer = False, None, None

    def arm(self, budget_ms, soft_ms=None, on_soft=None):
        """Stop at budget_ms of this thread's CPU from now; at soft_ms (if given), call on_soft once and go on."""
        self.c0 = time.thread_time_ns()
        self.hard = self.c0 + int(budget_ms * 1e6)
        self.soft = self.c0 + int(soft_ms * 1e6) if soft_ms is not None else None
        self.on_soft = on_soft
        self.cpu = None
        self.killer = _KILLER[0](int(budget_ms * 1e6) + HARD_GRACE_NS) if _KILLER else None
        self.armed = True
        signal.setitimer(signal.ITIMER_REAL, ((self.soft if self.soft is not None else self.hard) - self.c0) / 1e9)

    def alarm(self, *_):
        if not self.armed:
            return
        now = time.thread_time_ns()
        if self.soft is not None and now >= self.soft - SLACK_NS:
            self.soft = None
            self.on_soft()
        if now >= self.hard - SLACK_NS:
            raise Timeout("took too long")
        # The CPU left can't take less wall time than this.
        signal.setitimer(signal.ITIMER_REAL, max((self.soft if self.soft is not None else self.hard) - now, 1000) / 1e9)

    def stop(self):
        """Disarm, and return this call's CPU time so far in ms (the same figure on every later stop)."""
        if self.armed:
            self.armed = False
            signal.setitimer(signal.ITIMER_REAL, 0)
            self.cpu = (time.thread_time_ns() - self.c0) / 1e6
            if self.killer is not None:
                _KILLER[1](self.killer)
                self.killer = None
        return self.cpu


GUARD = _Guard()
signal.signal(signal.SIGALRM, GUARD.alarm)


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


def schedstat(pid):
    """(CPU ns, ns spent runnable but waiting for a CPU) of process pid, from /proc (stale by up to a tick)."""
    try:
        with open(f"/proc/{pid}/schedstat") as f:
            cpu, wait, _ = f.read().split()
        return int(cpu), int(wait)
    except (OSError, ValueError):
        return 0, 0


class Lines:
    """Lines from a forked call's reply pipe (a bee's call may send a notice line before its reply)."""

    def __init__(self, fd):
        self.fd, self.chunks = fd, []

    def next(self, seconds):
        """(line without its newline, "line") | (what was left, "eof") | (None, "timeout") within `seconds`."""
        deadline = time.monotonic() + seconds
        while True:
            if self.chunks and b"\n" in self.chunks[-1]:
                data = b"".join(self.chunks)
                i = data.index(b"\n")
                rest = data[i + 1:]
                self.chunks = [rest] if rest else []
                return data[:i], "line"
            left = deadline - time.monotonic()
            if left <= 0:
                return None, "timeout"
            ready, _, _ = select.select([self.fd], [], [], left)
            if not ready:
                return None, "timeout"
            b = os.read(self.fd, 1 << 20)
            if not b:
                return b"".join(self.chunks), "eof"
            self.chunks.append(b)


def main(role, setup):
    ms = setup["ms"]  # a flower's most R; a bee's CPU time to decide (and fed's hard limit)
    limit = setup.get("limitMs") or ms  # a bee's hard CPU limit for first and decide
    # Wall-clock backstops (ms): a flower is stopped at wallMs of wall time; a bee's first or decide is judged
    # at wallMs (a notice: late, or the server's fault) and stopped at hardWallMs; fed is stopped at wallMs.
    wall_ms = setup.get("wallMs") or (400 if role == "flower" else 250)
    hard_wall_ms = setup.get("hardWallMs") or max(4000, 2 * limit)
    fault_share = setup.get("faultShare") or 0.5
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
        _CLOCK["module"], start_clock = game_clock()
        ns = {"__name__": "__program__", "__builtins__": SAFE_BUILTINS, "GAME": dict(game)}
        if role == "flower" and not trial:
            ns["GAME"]["ms"] = budget  # this call's hidden time budget R: its CPU limit
        keep = False
        try:
            if role == "bee":
                ns["MEMORY"] = json.loads(req["memory"]) if req.get("memory") is not None else {}
            start_clock()  # the program's clock reads 0 as its time starts, and so does its CPU budget
            # A flower: stopped at R of CPU. A bee's first or decide: a notice to the engine at ms of CPU (it
            # is late), stopped at its hard limit.
            soft = ms if role == "bee" and not trial else None
            GUARD.arm(budget, soft, (lambda: write_all(w, b"N\n")) if soft is not None else None)
            write_all(w, b"S%d\n" % GUARD.c0)  # its CPU before the call's: if it's killed, rusage less this is the call's
            exec(code, ns)
            for name in ENTRY[role]:
                if not callable(ns.get(name)):
                    raise NameError(f"program must define {SIGNATURE[role]}")
            if trial:
                GUARD.stop()
                line = "{}"
            elif role == "flower":
                v = ns["flower"](req["c"])
                # Still on the clock: the reply as plain data, the response as JSON, and its size.
                try:
                    if type(v) in (list, tuple) and len(v) == 2:
                        rt, pt = dumps(plain(v[0])), dumps(plain(v[1]))
                        size = len(rt.encode("utf-8"))
                        if size > max_bytes:
                            raise NotPlain(f"the response is {size} bytes of JSON, over the cap of {max_bytes}")
                        tail = f'"bytes":{size},"v":[{rt},{pt}]}}'
                    else:
                        tail = f'"v":{dumps(plain(v))}}}'
                except NotPlain as e:
                    m = str(e)
                    tail = '"e":' + json.dumps(m if m.startswith("the response") else f"flower returned something that is not plain data ({m})") + "}"
                except UnicodeEncodeError:
                    tail = '"e":' + json.dumps("the response is not valid Unicode (a lone surrogate)") + "}"
                line = f'{{"cpu":{GUARD.stop()},' + tail
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
            cpu = GUARD.stop()
            line = json.dumps({"e": "Timeout: took too long" if isinstance(e, Timeout) else short(e), "cpu": cpu})
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
            start_clock()
            GUARD.arm(ms)  # fed: stopped at ms of CPU
            write_all(w, b"S%d\n" % GUARD.c0)
            v = ns["fed"](nectar)
            line, _ = bee_reply("fed", v, ns)
        except BaseException as e:
            cpu = GUARD.stop()
            line = json.dumps({"e": "Timeout: took too long" if isinstance(e, Timeout) else short(e), "cpu": cpu})
        line = line[:-1] + ',"out":' + json.dumps(captured.getvalue()[:2000]) + "}"
        write_all(w, b"." + line.encode("utf-8") + b"\n")
        os._exit(0)

    def bee_reply(op, v, ns):
        """
        Still on the clock: the reply (for fed, what it returned unless None) and MEMORY as plain data, then
        the clock stops. Returns (the reply's JSON text, with the call's CPU time, and the plain reply or None).
        """
        out = {"ok": True}
        a = None
        if op == "fed":
            # A bad return from fed is reported, and MEMORY is saved as if it had returned None.
            if v is not None:
                try:
                    a = plain(v)
                    if len(json.dumps(a)) > max_chars:
                        out["aError"] = f"fed returned something too large (over {max_chars} characters)"
                    else:
                        out["a"] = a
                except NotPlain as e:
                    out["aError"] = f"fed returned something that is not plain data ({e})"
        else:
            try:
                a = plain(v)
            except NotPlain as e:
                return json.dumps({"e": f"{op} returned something that is not plain data ({e})", "cpu": GUARD.stop()}), None
            if len(json.dumps(a)) > max_chars:
                return json.dumps({"e": f"{op} returned something too large (over {max_chars} characters)", "cpu": GUARD.stop()}), None
            out = {"a": a}
        try:
            memory = json.dumps(plain_memory(ns.get("MEMORY")), allow_nan=False)
            if len(memory) <= 1 << 20:
                out["memory"] = memory
            else:
                out["memoryError"] = "MEMORY is far too large"
        except NotPlain as e:
            out["memoryError"] = str(e) if str(e).startswith("MEMORY") else f"MEMORY is not plain data ({e})"
        out["cpu"] = GUARD.stop()
        return json.dumps(out), a

    def reap(pid, r, cw, kill, before_ns=0):
        """Close the call's pipes and reap its child (killed first if `kill`): (the call's CPU ms by rusage, less
        `before_ns`, its CPU before the call; killed by SIGKILL)."""
        if kill:
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
            _, status, ru = os.wait4(pid, 0)
            cpu = max(0.0, (ru.ru_utime + ru.ru_stime) * 1000 - before_ns / 1e6)
            return cpu, os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGKILL
        except ChildProcessError:
            return None, False

    def ended(pid, r, cw, extra, before_ns):
        """The child closed its pipe without a reply: stopped by its hard CPU limit, or it died."""
        cpu, killed = reap(pid, r, cw, False, before_ns)
        e = "Timeout: took too long (stopped by its CPU limit)" if killed else "the program's process ended without a reply"
        return json.dumps({"e": e, "cpu": cpu, **extra}).encode()

    def backstop(pid, r, cw, t0, budget, extra, before_ns):
        """Past the wall backstop: stopped, and the server's fault if it spent most of the time waiting for a CPU."""
        cpu_ns, wait_ns = schedstat(pid)
        wall = (time.monotonic() - t0) * 1000
        cpu, _ = reap(pid, r, cw, True, before_ns)
        cpu = cpu if cpu is not None else max(0.0, (cpu_ns - before_ns) / 1e6)
        fault = wait_ns / 1e6 >= fault_share * wall and cpu < budget
        e = (f"server fault: it waited {wait_ns / 1e6:.0f} ms of {wall:.0f} ms for a CPU, and ran {cpu:.1f} ms" if fault
             else f"Timeout: still running after {wall:.0f} ms of wall time ({cpu:.1f} ms of CPU)")
        return json.dumps({"e": e, "cpu": cpu, "backstop": True, "fault": fault, **extra}).encode()

    def run(req, budget, trial=False):
        """Run the program once in a forked child: its reply line (bytes). A bee's call may send a notice first."""
        r, w = os.pipe()
        cr, cw = os.pipe() if role == "bee" else (None, None)
        t0 = time.monotonic()
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
        extra = {"out": ""} if role == "bee" and not trial else {}
        lines = Lines(r)
        # A bee's first or decide is judged at wall_ms (unless it has replied, or used its ms of CPU, by then);
        # every call is stopped at the backstop.
        judge = None if trial or role == "flower" else wall_ms / 1000
        stop = max(5.0, 4 * budget / 1000) if trial else (wall_ms if role == "flower" else hard_wall_ms) / 1000
        before = 0
        while True:
            line, status = lines.next(t0 + (judge if judge is not None else stop) - time.monotonic())
            if status == "line":
                if line[:1] == b"S":
                    before = int(line[1:])
                    continue
                if line[:1] == b"N":  # the bee has used its ms of CPU: it is late
                    if judge is not None:
                        send(b'{"notice":"late"}')
                        judge = None
                    continue
                if line[:1] == b"W":
                    state["kept"] = (pid, r, cw)
                    return line[1:]
                reap(pid, r, cw, False)
                return line[1:]
            if status == "eof":
                return ended(pid, r, cw, extra, before)
            if judge is not None:  # no reply yet at wall_ms: late, unless it was waiting for a CPU
                cpu_ns, wait_ns = schedstat(pid)
                fault = cpu_ns - before < ms * 1e6 and wait_ns / 1e6 >= fault_share * (time.monotonic() - t0) * 1000
                send(b'{"notice":"fault"}' if fault else b'{"notice":"late"}')
                judge = None
                continue
            return backstop(pid, r, cw, t0, budget, extra, before)

    def drop_kept():
        if state["kept"]:
            pid, r, cw = state["kept"]
            state["kept"] = None
            reap(pid, r, cw, True)

    def fed(req):
        if not state["kept"]:
            return b'{"skipped":true}'
        pid, r, cw = state["kept"]
        state["kept"] = None
        t0 = time.monotonic()
        try:
            write_all(cw, json.dumps({"nectar": req.get("nectar")}).encode() + b"\n")
        except OSError:
            reap(pid, r, cw, True)
            return b'{"e":"the bee crashed","out":""}'
        lines, before = Lines(r), 0
        while True:
            line, status = lines.next(t0 + wall_ms / 1000 - time.monotonic())
            if status == "line" and line[:1] == b"S":
                before = int(line[1:])
                continue
            if status == "line":
                reap(pid, r, cw, False)
                return line[1:]
            if status == "eof":
                return ended(pid, r, cw, {"out": ""}, before)
            return backstop(pid, r, cw, t0, ms, {"out": ""}, before)

    try:
        code = compile(setup["code"], f"<{role}>", "exec")
        breaches = py_rules.check(setup["code"])
        if breaches:
            more = f" (and {len(breaches) - 1} more)" if len(breaches) > 1 else ""
            reply({"ok": False, "e": f"the program breaks the rules: {breaches[0]}{more}"})
            code = None
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
        if role == "flower":
            r = req.get("ms")  # R, this call's time budget (at most the flower window)
            budget = min(ms, r) if isinstance(r, (int, float)) and not isinstance(r, bool) and r > 0 else ms
            send(run(req, budget))
        else:
            send(run(req, limit))


if __name__ == "__main__":
    try:
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    except (ValueError, OSError):
        pass
    main(sys.argv[1], json.loads(sys.stdin.readline()))
