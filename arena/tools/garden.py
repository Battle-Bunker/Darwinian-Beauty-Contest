"""The garden, for your scaffold: a program of your own that runs outside the game engine for the rest of the game and
reacts to what happens by changing your programs itself (start it with tools/scaffold.py; tools/ is on its import path,
so `import garden` works). Sessions can use it too (after sys.path.insert(0, "tools")).

    import garden

    for e in garden.follow():                       # each new entry of your team ledger as it arrives (about once a second)
        if e["fed"] and e["flower"] == garden.MY_INDEX:
            ...                                     # a bee fed at your flower: e["percent"], e["energy"], e["nectar"], e["surplus"]
    s = garden.status()                             # clock, round, live scores; YOUR budgets (exact) and versions
    m = garden.measure("flower", code)              # free: {"ok", "size", "cost", "available", "errors"}
    r = garden.submit("flower", code)               # live at once if affordable; else r["ok"] is False and
                                                    # r["wait_s"] says how long until it is (None: never, too big)
    garden.wait_for_budget("bee", 300)              # sleep until 300 nodes of change are available
    code = garden.live("bee")                       # the source of your bee playing now

The change budget is enforced by the server: a submission you can't afford is refused, nothing else happens.
Everything goes through the game runner (tools/_runner.py): no password or token is ever needed here.

Ledger entries are dicts (stream/SCHEMA.md): seq, round, bee, flower (team indices 0..N-1), challenge, response, fed,
nectar, percent, energy, ms, surplus; a field your team may not see is None. garden.MY_INDEX is your index, garden.N the
number of teams, garden.name(i) a team's name. follow_live() yields the public actions (arrive, feed, leave; teams as
ids, garden.ME is yours) straight from the game's public API.
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _runner import ROOT, call  # noqa: E402
from stream import Stream  # noqa: E402

_s = Stream(ROOT)


def __getattr__(attr):
    """garden.ME (your team id), garden.MY_INDEX (your index in the ledger), garden.N (the number of teams) and
    garden.TEAMS (ids -> names). In the lobby MY_INDEX is None and N is 0: the indices are fixed when the game starts,
    and from then on these give them (a scaffold started in the lobby needn't restart)."""
    if attr in ("ME", "MY_INDEX", "N", "TEAMS"):
        return {"ME": lambda: _s.me, "MY_INDEX": lambda: _s.my_index, "N": lambda: _s.n, "TEAMS": lambda: _s.teams}[attr]()
    raise AttributeError("module 'garden' has no attribute %r" % attr)


KINDS = ("flower", "bee")
try:
    with open(os.path.join(ROOT, "config.json")) as _f:
        CONFIG = json.load(_f)
except (OSError, ValueError):
    CONFIG = {}
API = CONFIG.get("public_api")


def name(team):
    """A team's name from its ledger index or its id."""
    return _s.name(team)


# ---------------------------------------------------------------- the ledger and the stream

def turns(since_round=None):
    """Your team ledger so far (from stream/ledger.jsonl), oldest first."""
    return _s.turns(since_round=since_round)


def last():
    """The latest ledger entry, or None."""
    return _s.last()


def follow(after=None, poll=0.1):
    """Yield each new ledger entry as the runner appends it to stream/ledger.jsonl (about once a second). Starts after
    seq `after`, or at the end of what's there now. Never returns: break out of it yourself."""
    if after is None:
        e = _s.last()
        after = e["seq"] if e else 0
    for e in _s.follow(poll=poll, from_start=True):
        if e.get("seq", 0) > after:
            after = e["seq"]
            yield e


def ledger(after=0):
    """Ledger entries with seq > after, fresh from the game through the runner (the file can be a second behind).
    {"ok", "entries", "lastSeq", "round", "status", "participants", "team"}."""
    return call("ledger", after=after)


def actions(after=0, since_ms=None):
    """The public stream so far (stream/actions.jsonl) with seq > after, or from game time since_ms on."""
    return _s.actions(since_ms=since_ms, since_seq=after or None)


def mine():
    """Your own bee's and flower's actions as your team sees them (with your timings, versions, printouts)."""
    return _s.mine()


def _sse_messages(after):
    with urllib.request.urlopen("%s/events?after=%d" % (API, after), timeout=30) as resp:
        for raw in resp:
            if raw.startswith(b"data: "):
                yield json.loads(raw[6:])


def follow_live(after=None):
    """The public actions (arrive, feed, leave) straight from the game's public API (Server-Sent Events), as they happen.
    Reconnects if the connection drops. (The API also has a WebSocket, API + "/ws?after=<seq>", with the same messages;
    Python's standard library has no client for it, and raw sockets aren't allowed here.)"""
    if after is None:
        a = None
        for a in _s.actions():
            pass
        after = a["seq"] if a else 0
    while True:
        try:
            for msg in _sse_messages(after):
                for a in msg.get("actions") or []:
                    if a["seq"] > after:
                        after = a["seq"]
                        yield a
        except Exception:
            time.sleep(1)


def scores():
    """The live scoreboard from the public API: status, clockMs, endMs, round, scores, ledgers."""
    with urllib.request.urlopen(API + "/scores", timeout=10) as resp:
        return json.loads(resp.read())


def game_over():
    """True once the game has finished."""
    try:
        return scores().get("status") == "finished"
    except Exception:
        return False


# ---------------------------------------------------------------- your programs

def status(afford=None):
    """{"status", "clockMs", "endMs", "leftMs", "round", "budgets": {kind: {"available", "exact", "perMinute", "cap", ...}},
    "scores" (the live scoreboard), "versions": {kind: {"version", "size", "atMs", ...}}, "text"}"""
    return call("status", afford=afford)


def live(kind):
    """The source code of your program playing now (None if there is none yet)."""
    r = call("status", code=True)
    v = (r.get("versions") or {}).get(kind)
    return v.get("code") if v else None


def check(kind, code, test=True):
    """Free: size against the budget, what submitting would cost now, a quick runtime test. {"ok", "size", "cost",
    "available", "errors", "minified", ...}"""
    return call("check", kind=kind, code=code, test=test)


def measure(kind, code):
    """Free and quick (no runtime test): {"ok", "size", "cost" (node edits from the version playing now), "available",
    "errors"}."""
    r = call("check", kind=kind, code=code, test=False)
    return {k: r.get(k) for k in ("ok", "size", "cost", "available", "errors", "budget")}


def try_flower(code, challenges=None, ledger=None):
    """Run a flower on challenges on the game's real runner without submitting it: {"ok", "results": [{"c", "r",
    "percent", "energy", "ms", "error"}]}. ledger: what it gets as its ledger (default [])."""
    return call("try", kind="flower", code=code, challenges=challenges, ledger=ledger)


def try_bee(code, rounds=None, flower=None):
    """Run a bee for `rounds` rounds in a garden of just your own flower (`flower` code, else your latest submitted one):
    {"ok", "feeds", "nectar", "surplus", "rounds", "actions", "problems"}."""
    return call("try", kind="bee", code=code, rounds=rounds, flower=flower)


def submit(kind, code, force=False):
    """Submit: live at once if you can afford it. {"ok", "version", "cost", "available", "atMs", "errors", "wait_s",
    "text"}. When it's refused for budget, wait_s is how long until you can afford it (None: never; make it smaller).
    A quick runtime test runs first (force=True skips it)."""
    r = call("submit", kind=kind, code=code, force=force)
    r["wait_s"] = r.get("waitS")
    return r


def wait_for_budget(kind, cost, timeout=None):
    """Sleep until `cost` nodes of change are available for `kind`. False if that can never happen (above the cap),
    the game ends, or `timeout` seconds pass."""
    t0 = time.time()
    while True:
        s = status()
        if not s.get("ok", True) or s.get("status") == "finished":
            return False
        b = (s.get("budgets") or {}).get(kind)
        if not b:
            return False
        if b["exact"] >= cost:
            return True
        if cost > b["cap"] or b["perMinute"] <= 0:
            return False
        wait = (cost - b["exact"]) * 60.0 / b["perMinute"] + 0.2
        if timeout is not None:
            left = timeout - (time.time() - t0)
            if left <= 0:
                return False
            wait = min(wait, left)
        time.sleep(min(wait, 10))
