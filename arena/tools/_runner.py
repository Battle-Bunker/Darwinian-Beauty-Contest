"""Talk to the game runner: the tools in this folder hand their request to the runner through files in
.runner/ and wait for its answer. The runner does what needs your team's login (submitting, checking,
trying, reading your budgets) and writes the result back. No password or token ever passes through here.

    from _runner import call
    result = call("status")
"""
import json
import os
import sys
import time
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQ = os.path.join(ROOT, ".runner", "req")
RES = os.path.join(ROOT, ".runner", "res")


def call(op, timeout=180, **args):
    """Send one request to the runner and wait for its answer (a dict). ok is False if it failed."""
    os.makedirs(REQ, exist_ok=True)
    rid = "%d-%s" % (int(time.time() * 1000), uuid.uuid4().hex[:8])
    tmp = os.path.join(REQ, rid + ".tmp")
    with open(tmp, "w") as f:
        json.dump(dict(args, id=rid, op=op), f)
    os.replace(tmp, os.path.join(REQ, rid + ".json"))
    res = os.path.join(RES, rid + ".json")
    t0 = time.time()
    while time.time() - t0 < timeout:
        if os.path.exists(res):
            try:
                with open(res) as f:
                    return json.load(f)
            except ValueError:
                pass  # still being written
        time.sleep(0.15)
    return {"ok": False, "error": "no answer from the game runner within %d s (your session may be over)" % timeout}


def read_code(kind, path=None):
    path = path or "%s.py" % kind
    full = path if os.path.isabs(path) else os.path.join(os.getcwd(), path)
    if not os.path.exists(full):
        full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        sys.exit("no such file: %s" % path)
    with open(full) as f:
        return f.read()


def kind_arg(args):
    if not args or args[0] not in ("clover", "orchid", "bee"):
        sys.exit("first argument: clover, orchid or bee")
    return args[0]


def mmss(ms):
    if ms is None:
        return "-"
    s = int(round(ms / 1000.0))
    return "%d:%02d" % (s // 60, s % 60)


def show(result, as_json=False):
    if as_json:
        print(json.dumps(result, indent=1))
        return
    for line in result.get("text", "").rstrip().split("\n"):
        print(line)
    if not result.get("text"):
        print(json.dumps(result, indent=1))
