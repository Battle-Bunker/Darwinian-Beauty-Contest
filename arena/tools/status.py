"""Where the game stands right now: the clock and time left, your change budgets (available now, rate,
cap, and when you can afford a change of N nodes), the live scores (fitness, pollination and forage, with their
shares), the versions of your programs playing now, and your bee's MEMORY (read only: only your bee writes it).

    python3 tools/status.py
    python3 tools/status.py --afford 300     # when could each program afford a 300-node change?
    python3 tools/status.py --memory         # ...and the value of your bee's MEMORY
    python3 tools/status.py --json
"""
import sys
from _runner import call, show

afford = None
if "--afford" in sys.argv:
    afford = int(sys.argv[sys.argv.index("--afford") + 1])
r = call("status", afford=afford, memory="--memory" in sys.argv)
show(r, "--json" in sys.argv)
sys.exit(0 if r.get("ok") else 1)
