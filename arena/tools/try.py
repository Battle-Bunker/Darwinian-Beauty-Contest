"""Run a program on the game's real runner without submitting it (free, any time).

    python3 tools/try.py clover                    # clover.py on a few sample challenges
    python3 tools/try.py orchid orchid.py 1 42 99  # your challenges (JSON values: 7, "abc", [1,2])
    python3 tools/try.py bee                       # bee.py foraging a garden of just your own two flowers
    python3 tools/try.py bee my_bee.py --json      # raw result: every action of the try

The runner runs the program minified, exactly as the game would.
"""
import json
import sys
from _runner import call, kind_arg, read_code, show

args = [a for a in sys.argv[1:] if not a.startswith("--")]
kind = kind_arg(args)
path = args[1] if len(args) > 1 and (args[1].endswith(".py") or args[1].endswith(".ts")) else None
rest = args[2:] if path else args[1:]
challenges = []
for a in rest:
    try:
        challenges.append(json.loads(a))
    except ValueError:
        challenges.append(a)
code = read_code(kind, path)
r = call("try", kind=kind, code=code, challenges=challenges or None)
show(r, "--json" in sys.argv)
sys.exit(0 if r.get("ok") else 1)
