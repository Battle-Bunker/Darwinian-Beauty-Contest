"""Run a program on the game's real runner without submitting it (free, any time).

    python3 tools/try.py flower                     # flower.py on a few sample challenges
    python3 tools/try.py flower flower.py 1 42 99   # your challenges (JSON values: 7, "abc", [1,2])
    python3 tools/try.py flower --history FILE      # ...with these turn records as its HISTORY.turns (a JSON list, or a
                                                    # .jsonl file such as stream/history.jsonl)
    python3 tools/try.py bee                        # bee.py for 300 rounds in a garden of just your own flower
    python3 tools/try.py bee my_bee.py --rounds 100 --flower flower.py
    python3 tools/try.py bee --memory '{"seen": 3}' # the test bee starts with this MEMORY (JSON, or a .json file)
    python3 tools/try.py bee --json                 # raw result: every turn of the try, and the test bee's final MEMORY

A flower shows each response with its percent, the turn's excess energy E and its CPU time. A bee plays your
latest submitted flower unless you name a flower file. A try runs a separate test bee: it never reads or changes
your game bee's MEMORY (only your deployed bee writes that). The runner runs the program minified, exactly as the
game would.
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
for name in ("--history", "--flower", "--rounds", "--memory"):
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
    history = None
    if opt("--history"):
        with open(opt("--history")) as f:
            text = f.read()
        try:
            history = json.loads(text)
        except ValueError:
            history = [json.loads(line) for line in text.splitlines() if line.strip()]
        if isinstance(history, dict):
            history = [history]  # a .jsonl file of one record
    r = call("try", kind=kind, code=code, challenges=challenges or None, history=history)
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
