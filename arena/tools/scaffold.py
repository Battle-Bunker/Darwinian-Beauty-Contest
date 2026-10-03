"""Your scaffold: a program of your own that runs OUTSIDE the game engine for the rest of the game, watching the
stream and submitting changes by itself (with tools/garden.py). Sessions come and go; the scaffold keeps running.

    python3 tools/scaffold.py start [scaffold.py]   # audit it, then start it; it runs until the game ends
    python3 tools/scaffold.py restart [file]        # stop it and start it again (after editing it)
    python3 tools/scaffold.py stop
    python3 tools/scaffold.py status                # running?, restarts, crashes, CPU used
    python3 tools/scaffold.py logs [-n 40]          # its latest output (print() goes there; also scaffold/scaffold.log)

Before every start and restart the runner audits its code (the file and the workspace modules it imports): it may not
use paths outside this workspace, logins or credentials, the network beyond reading the game's public API, the
environment, or anything that escapes supervision (subprocesses, os.system, fork, exec/eval, dynamic imports), and it
may not write to stream/. It runs with a small CPU share and memory limit. If it crashes it is restarted (after 1, 2,
4, ... 30 s); if it exits normally it stays stopped. It is stopped when the game ends.
"""
import sys
from _runner import call, show

args = [a for a in sys.argv[1:] if not a.startswith("-")]
action = args[0] if args else "status"
if action not in ("start", "restart", "stop", "status", "logs"):
    sys.exit(__doc__)
req = {"action": action}
if action in ("start", "restart"):
    req["file"] = args[1] if len(args) > 1 else "scaffold.py"
if action == "logs" and "-n" in sys.argv:
    req["n"] = int(sys.argv[sys.argv.index("-n") + 1])
r = call("scaffold", **req)
show(r, "--json" in sys.argv)
sys.exit(0 if r.get("ok") else 1)
