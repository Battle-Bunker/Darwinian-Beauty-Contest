"""Run a program on the game's real runner without submitting it (free, any time).

    python3 tools/try.py flower                     # flower.py on a few sample challenges
    python3 tools/try.py flower flower.py 1 42 99   # your challenges (JSON values: 7, "abc", [1,2])
    python3 tools/try.py flower --budget 60         # every call with this hidden budget R (ms), as GAME["ms"]
    python3 tools/try.py flower --budget random     # a fresh random R per call, as in a game (the default)
    python3 tools/try.py bee                        # bee.py for 300 rounds in a garden of just your own flower
    python3 tools/try.py bee my_bee.py --rounds 100 --flower flower.py
    python3 tools/try.py bee --memory '{"seen": 3}' # the test bee starts with this MEMORY (JSON, or a .json file)
    python3 tools/try.py bee --json                 # raw result: every turn of the try, and the test bee's final MEMORY

A flower shows each response with its percent, the call's hidden budget R (its time limit, which it reads as
GAME["ms"]), the turn's excess energy E = (size cap - size) x max(0, R - CPU ms), times (byte cap - response bytes) /
byte cap when the game's energy has the byte factor (config.json: energy.bytes; the cap is maxResponseBytes, and a
bigger response is refused), its CPU time and its size in bytes (a response over 4 KB as its size, hash and first
characters). A bee plays your latest submitted flower unless you name a flower file; as in a
game, its fed(nectar), if it defines one, runs after every feed it decides in time, in the same instance as that
decide, and MEMORY is saved after it. The result says how often fed ran and whether it failed. A try runs a separate
test bee: it never reads or changes your game bee's MEMORY (only your deployed bee writes that). The runner runs the
program minified, exactly as the game would.
"""
import json
import sys
from _runner import call, kind_arg, read_code, show


def opt(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


skip = set()
for name in ("--flower", "--rounds", "--memory", "--budget"):
    if name in sys.argv:
        i = sys.argv.index(name)
        skip.update((i, i + 1))
args = [a for i, a in enumerate(sys.argv[1:], 1) if i not in skip and not a.startswith("--")]
kind = kind_arg(args)
path = args[1] if len(args) > 1 and (args[1].endswith(".py") or args[1].endswith(".ts")) else None
code = read_code(kind, path)
if kind == "flower":
    rest = args[2:] if path else args[1:]
    challenges = []
    for a in rest:
        try:
            challenges.append(json.loads(a))
        except ValueError:
            challenges.append(a)
    budget = opt("--budget")
    if budget is not None and budget != "random":
        try:
            budget = float(budget)
        except ValueError:
            sys.exit("--budget: a number of ms, or random")
    r = call("try", kind=kind, code=code, challenges=challenges or None, budget=budget)
else:
    flower = read_code("flower", opt("--flower")) if opt("--flower") else None
    rounds = int(opt("--rounds")) if opt("--rounds") else None
    memory = None
    if opt("--memory") is not None:
        m = opt("--memory")
        if m.endswith(".json"):
            with open(m) as f:
                m = f.read()
        memory = json.loads(m)
    r = call("try", kind=kind, code=code, flower=flower, rounds=rounds, memory=memory)
show(r, "--json" in sys.argv)
sys.exit(0 if r.get("ok") else 1)
