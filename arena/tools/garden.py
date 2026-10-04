"""The garden, for your scaffold: a program of your own that runs outside the game engine for the rest of the game and
reacts to what happens by changing your programs itself (start it with tools/scaffold.py; tools/ is on its import path,
so `import garden` works). Sessions can use it too (after sys.path.insert(0, "tools")).

    import garden

    # The game's history, with the same typed query builder your programs use on HISTORY (tools/history.py):
    garden.HISTORY.turns.my_flower().eq("fed", True).avg("percent").value()   # exactly your programs' HISTORY, kept up
                                                                              # to date from stream/history.jsonl
    garden.game.scores.order_by("fitness", desc=True).rows()   # run by the game, as your team may see it: turns,
    garden.game.versions.mine().rows()                         # versions (your own), teams, pairs, scores
    garden.room.turns.eq("fed", True).count().value()          # the room's finished games, fully revealed

    for t in garden.follow():                       # each new turn as it arrives (about once a second)
        if t.fed and t.flower == garden.MY_INDEX:
            ...                                     # a bee fed at your species: t.percent, t.energy, t.nectar, t.pollen
    s = garden.status()                             # clock, round, live scores; YOUR budgets (exact) and versions
    m = garden.memory()                             # your bee's MEMORY: {"value", "bytes", "cap", "version"} (read only)
    m = garden.measure("flower", code)              # free: {"ok", "size", "cost", "available", "errors"}
    r = garden.submit("flower", code)               # live at once if affordable; else r["ok"] is False and
                                                    # r["wait_s"] says how long until it is (None: never, too big)
    garden.wait_for_budget("bee", 300)              # sleep until 300 nodes of change are available
    code = garden.live("bee")                       # the source of your bee playing now

The change budget is enforced by the server: a submission you can't afford is refused, nothing else happens. Your bee's
MEMORY is written only by your deployed bee: nothing here can set it, and it is emptied whenever your bee's code changes.
Everything goes through the game runner (tools/_runner.py): no password or token is ever needed here.

Turns are the same records as in HISTORY (Python field names: round, at_ms, bee, flower, challenge, response, fed,
percent, energy, nectar, pollen, ms, flower_version, ...); a field your team may not see is None. garden.MY_INDEX is your
index, garden.N the number of teams, garden.name(i) a team's name. follow_live() yields the public actions (arrive, feed,
leave; teams as ids, garden.ME is yours) straight from the game's public API.
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
KINDS = ("flower", "bee")
try:
    with open(os.path.join(ROOT, "config.json")) as _f:
        CONFIG = json.load(_f)
except (OSError, ValueError):
    CONFIG = {}
API = CONFIG.get("public_api")


def _where():
    """(server base, room, game) from the public API address in config.json."""
    if not API or "/api/rooms/" not in API:
        return None, None, None
    base, rest = API.split("/api/rooms/", 1)
    parts = rest.split("/")
    return base, parts[0], parts[2] if len(parts) > 2 else None


# ---------------------------------------------------------------- history queries (tools/history.py)

_hist = {"local": None, "offset": 0, "team": None, "game": None, "room": None}


def _client():
    import history  # tools/history.py: the generated client (docs/QUERY.md)
    return history


def _post_game(path, ast):
    r = call("query", ast=ast)
    if not r.get("ok"):
        raise RuntimeError(r.get("error") or r.get("text") or "query failed")
    return {"rows": r.get("rows") or [], "truncated": r.get("truncated", False)}


def _post_room(path, ast):
    r = call("query", ast=ast, room=True)
    if not r.get("ok"):
        raise RuntimeError(r.get("error") or r.get("text") or "query failed")
    return {"rows": r.get("rows") or [], "truncated": r.get("truncated", False)}


def _local():
    """The in-memory history over stream/history.jsonl, topped up with the turns appended since the last call."""
    team = _s.my_index
    st = _hist
    if st["local"] is None or st["team"] != team:
        st["local"] = _client().local([], team=team if team is not None else 0)
        st["offset"], st["team"] = 0, team
    path = _s.history_file
    if os.path.exists(path) and os.path.getsize(path) > st["offset"]:
        with open(path, "rb") as f:
            f.seek(st["offset"])
            data = f.read()
        end = data.rfind(b"\n") + 1  # whole lines only: the runner may be writing the last one
        records = []
        for raw in data[:end].split(b"\n"):
            if raw.strip():
                try:
                    rec = json.loads(raw)
                except ValueError:
                    continue
                rec.pop("seq", None)
                records.append(rec)
        st["offset"] += end
        if records:
            st["local"].append(records)
    return st["local"]


def __getattr__(attr):
    """garden.HISTORY: your programs' HISTORY (turns), kept up to date. garden.game / garden.room: the query builder run
    by the game (this game as your team may see it / the room's finished games). garden.ME (your team id),
    garden.MY_INDEX (your team index), garden.N (the number of teams) and garden.TEAMS (ids -> names): in the lobby
    MY_INDEX is None and N is 0; the indices are fixed when the game starts, and from then on these give them (a scaffold
    started in the lobby needn't restart)."""
    if attr == "HISTORY":
        return _local().history
    if attr == "game":
        if _hist["game"] is None:
            base, room, game = _where()
            _hist["game"] = _client().connect(base, room, game, post=_post_game)
        return _hist["game"]
    if attr == "room":
        if _hist["room"] is None:
            base, room, _ = _where()
            _hist["room"] = _client().connect(base, room, post=_post_room)
        return _hist["room"]
    if attr in ("ME", "MY_INDEX", "N", "TEAMS"):
        return {"ME": lambda: _s.me, "MY_INDEX": lambda: _s.my_index, "N": lambda: _s.n, "TEAMS": lambda: _s.teams}[attr]()
    raise AttributeError("module 'garden' has no attribute %r" % attr)


def name(team):
    """A team's name from its index or its id."""
    return _s.name(team)


def turns():
    """Every turn so far (your programs' HISTORY): a tuple of Turn records, oldest first."""
    return _local().turns.rows()


def last():
    """The latest turn, or None."""
    rows = _local().turns.order_by("round", desc=True).limit(1).rows()
    return rows[0] if rows else None


def follow(poll=0.1, from_start=False):
    """Yield each new turn (a Turn record, as in HISTORY) as the runner appends it to stream/history.jsonl (about once a
    second). Starts after what's there now, unless from_start. Never returns: break out of it yourself."""
    done = 0 if from_start else _local().turns.count().value()
    while True:
        n = _local().turns.count().value()
        if n > done:
            for t in _local().turns.offset(done).rows():
                yield t
            done = n
        else:
            time.sleep(poll)


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
    "scores" (the live scoreboard), "versions": {kind: {"version", "size", "atMs", ...}}, "memory", "text"}"""
    return call("status", afford=afford)


def memory():
    """Your bee's MEMORY as the game holds it: {"value", "bytes", "cap", "version"} (None before your bee has one). Read
    only: only your deployed bee writes it, and a new bee version starts with {}."""
    r = call("status", memory=True)
    return r.get("memory")


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


def try_flower(code, challenges=None, history=None):
    """Run a flower on challenges on the game's real runner without submitting it: {"ok", "size", "results": [{"c", "r",
    "percent", "energy", "ms", "error"}]}. history: turn records for its HISTORY.turns (default none)."""
    return call("try", kind="flower", code=code, challenges=challenges, history=history)


def try_bee(code, rounds=None, flower=None, memory=None):
    """Run a test bee for `rounds` rounds in a garden of just your own flower (`flower` code, else your latest submitted
    one), starting with `memory` as its MEMORY (default {}): {"ok", "feeds", "nectar", "pollen", "rounds", "memory" (the
    test bee's at the end), "actions", "problems"}. It never touches your game bee's MEMORY."""
    return call("try", kind="bee", code=code, rounds=rounds, flower=flower, memory=memory)


def submit(kind, code, force=False):
    """Submit: live at once if you can afford it. {"ok", "version", "cost", "available", "atMs", "errors", "wait_s",
    "text"}. When it's refused for budget, wait_s is how long until you can afford it (None: never; make it smaller).
    A quick runtime test runs first (force=True skips it). A new bee version starts with an empty MEMORY."""
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
