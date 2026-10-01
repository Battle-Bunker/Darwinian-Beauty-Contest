# Scores flower responses with the example checkers (arena/examples/v3/checkers.py), for
# analysis/calibrate-examples.mjs. argv[1] is the checker program to run: the raw file, or its minified
# form (what a bee would actually run) with a forage() hook appended that hands back the two checkers.
# Reads JSON lines {"ex": "paley" | "graceful", "c": challenge, "r": response, "enough": k?} and writes
# {"s": score, "ms": checker time} lines.
import json
import sys
import time

ns = {}
exec(open(sys.argv[1]).read(), ns)
paley, graceful = ns["forage"](None, None) if "forage" in ns else (ns["check_paley"], ns["check_graceful"])
for line in sys.stdin:
    req = json.loads(line)
    check = paley if req["ex"] == "paley" else graceful
    args = (req["c"], req["r"]) + ((req["enough"],) if req.get("enough") else ())
    t0 = time.perf_counter()
    s = check(*args)
    ms = (time.perf_counter() - t0) * 1000
    print(json.dumps({"s": s, "ms": ms}), flush=True)
