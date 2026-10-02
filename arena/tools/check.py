"""Check a program without submitting it (free, any time): its size against the size budget, what it
would cost to submit now and whether you can afford it, and a quick runtime test.

    python3 tools/check.py clover             # checks clover.py
    python3 tools/check.py bee my_bee.py
    python3 tools/check.py orchid --no-test   # size and cost only
    python3 tools/check.py orchid --json      # raw result, including the minified program the game runs
"""
import sys
from _runner import call, kind_arg, read_code, show

args = [a for a in sys.argv[1:] if not a.startswith("--")]
kind = kind_arg(args)
code = read_code(kind, args[1] if len(args) > 1 else None)
r = call("check", kind=kind, code=code, test="--no-test" not in sys.argv)
show(r, "--json" in sys.argv)
sys.exit(0 if r.get("ok") else 1)
