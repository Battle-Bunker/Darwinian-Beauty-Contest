"""Submit a program: it goes live at once and pays for its change from your change budget.

    python3 tools/submit.py flower            # submits flower.py
    python3 tools/submit.py flower my_flower.py
    python3 tools/submit.py bee --force       # skip the quick runtime test
    python3 tools/submit.py bee --json        # print the raw result

Before the game starts (the lobby) submitting is free. While it runs, the change costs its node edits
from the version playing now; if you can't afford it yet, nothing happens and you're told how long
until you can. The runner first runs a quick runtime test (flower: a few challenges; bee: a short garden
of your own flower) and refuses to submit a program that crashes, unless you pass --force.

From your own script:  sys.path.insert(0, "tools"); from _runner import call
                       r = call("submit", kind="flower", code=source)   # r["ok"], r["text"], r["cost"], ...
"""
import sys
from _runner import call, kind_arg, read_code, show

args = [a for a in sys.argv[1:] if not a.startswith("--")]
kind = kind_arg(args)
code = read_code(kind, args[1] if len(args) > 1 else None)
r = call("submit", kind=kind, code=code, force="--force" in sys.argv)
show(r, "--json" in sys.argv)
sys.exit(0 if r.get("ok") else 1)
