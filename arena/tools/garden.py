"""The garden, for your scaffold: a program of your own that runs outside the game engine for the rest of the game and
reacts to what happens by changing your programs itself (start it with tools/scaffold.py; tools/ is on its import path,
so `import garden` works). Sessions can use it too (after sys.path.insert(0, "tools")).

    import garden

    # The game's history, with a typed query builder (tools/history.py). Your programs see no history: this is for you.
    garden.local.turns.my_flower().eq("fed", True).avg("percent").value()     # your team's history, kept up to date
                                                                              # from stream/history.jsonl
    garden.game.scores.order_by("fitness", desc=True).rows()   # run by the game, as your team may see it: turns,
    garden.game.versions.mine().rows()                         # versions (your own), teams, pairs, scores
    garden.room.turns.eq("fed", True).count().value()          # the room's finished games, fully revealed

    for t in garden.follow():                       # each new turn as it arrives (about once a second)
        if t.fed and t.flower == garden.MY_INDEX:
            ...                                     # a bee fed at your species: t.percent, t.energy, t.nectar, t.pollen
    s = garden.status()                             # clock, round, live scores; YOUR budgets (exact) and versions
    p = garden.prevalence()                         # species prevalence samples, in a game that has it (also in
                                                    # garden.scores(), and as garden.game.prevalence in queries)
    r = garden.response(t)                          # a turn's whole response (one over 4 KB is None in t.response)
    for g in garden.grains(flower=2): ...           # your pollen grains (a piece of the code of each flower your bee
                                                    # fed at): {"seq", "round", "at_ms", "flower", "version",
                                                    # "code_length", "grain"}, oldest first
    a = garden.assemble(flower=2, version=3)        # those grains pieced together: {"pieces", "covered", "share",
                                                    # "complete", "code"} (best effort)
    m = garden.memory()                             # your bee's MEMORY: {"value", "bytes", "cap", "version", "error"}
                                                    # (read only)
    m = garden.measure("flower", code)              # free: {"ok", "size", "cost", "available", "errors"}
    r = garden.submit("flower", code)               # live at once if affordable; else r["ok"] is False and
                                                    # r["wait_s"] says how long until it is (None: never, too big)
    garden.wait_for_budget("bee", 300)              # sleep until 300 nodes of change are available
    code = garden.live("bee")                       # the source of your bee playing now

The change budget is enforced by the server: a submission you can't afford is refused, nothing else happens. Your bee's
MEMORY is written only by your deployed bee: nothing here can set it, and it is emptied whenever your bee's code changes.
Everything goes through the game runner (tools/_runner.py): no password or token is ever needed here.

Turns are the records of stream/history.jsonl (Python field names: seq, round, at_ms, bee, flower, challenge, response,
response_bytes, response_hash, fed, percent, energy, nectar, pollen, ms, flower_version, ...); a field your team may not
see is None, and so is a response over 4 KB (response_bytes and response_hash say what it is; garden.response(t) fetches it). garden.MY_INDEX is your
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
from stream import Stream, response as _response  # noqa: E402
import grains as _grains  # noqa: E402

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
                records.append(rec)
        st["offset"] += end
        if records:
            st["local"].append(records)
    return st["local"]


def __getattr__(attr):
    """garden.local: your team's history (turns) from stream/history.jsonl, kept up to date. garden.game / garden.room: the
    query builder run
    by the game (this game as your team may see it / the room's finished games). garden.ME (your team id),
    garden.MY_INDEX (your team index), garden.N (the number of teams) and garden.TEAMS (ids -> names): in the lobby
    MY_INDEX is None and N is 0; the indices are fixed when the game starts, and from then on these give them (a scaffold
    started in the lobby needn't restart)."""
    if attr == "local":
        return _local().history
    if attr == "HISTORY":
        raise AttributeError("garden.HISTORY is now garden.local (your team's history; programs see no history)")
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
    """Every turn so far (your team's history): a tuple of Turn records, oldest first."""
    return _local().turns.rows()


def last():
    """The latest turn, or None."""
    rows = _local().turns.order_by("round", desc=True).limit(1).rows()
    return rows[0] if rows else None


def follow(poll=0.1, from_start=False):
    """Yield each new turn (a Turn record) as the runner appends it to stream/history.jsonl (about once a
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


def response(turn):
    """The whole response of a turn (a Turn record, a dict with "seq", or the seq itself), parsed: a response over 4 KB
    is None in the files and queries, with its size and hash. None if the flower failed. Fetched from the game's public
    API when needed (a few are kept)."""
    if isinstance(turn, int):
        return _response(turn)
    get = (lambda k: turn.get(k)) if isinstance(turn, dict) else (lambda k: getattr(turn, k, None))
    r = get("response") if get("response") is not None else get("r")
    if r is not None or (get("response_bytes") is None and get("responseBytes") is None and get("rBytes") is None):
        return r
    return _response(get("seq"))


def grains(flower=None, version=None):
    """Your team's pollen grains so far, oldest first: on every feed of your bee, floor(pollen ** (1/3)) characters of
    the minified code of the flower version that answered, from a random start, wrapping. [{"seq", "round", "at_ms",
    "flower" (team index), "version", "code_length", "grain"}]. Only your team sees them during play; programs never
    do."""
    return _grains.grains(flower, version, _s)


def assemble(flower, version=None):
    """Your grains of one species (team index) pieced together where they overlap (best effort), for one version (the
    latest you have grains of, by default): {"flower", "version", "grains", "code_length", "pieces", "covered",
    "share", "complete", "code" (the whole minified code once complete), "compiles"}."""
    _g = _grains
    gs = _g.grains(flower, version, _s)
    if version is None and gs:
        version = gs[-1]["version"]
        gs = [g for g in gs if g["version"] == version]
    if not gs:
        return {"flower": flower, "version": version, "grains": 0, "code_length": None, **_g.assemble([], 0)}
    lang = CONFIG.get("language", "python")
    return {"flower": flower, "version": version, "grains": len(gs), "code_length": gs[-1]["code_length"],
            **_g.assemble([g["grain"] for g in gs], gs[-1]["code_length"], lang)}


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
    """The live scoreboard from the public API: status, clockMs, endMs, round, scores, ledgers, and in a game with species
    prevalence its latest sample (prevalence: {..., "c", "species": [{"team", "index", "p", "P"}]})."""
    with urllib.request.urlopen(API + "/scores", timeout=10) as resp:
        return json.loads(resp.read())


def prevalence(after=0):
    """Species prevalence (games that have it), from the public API: {"prevalence": its settings (None: uniform draws),
    "samples": [{"round", "atMs", "c", "species": [{"team", "index", "p", "P"}]}]}, the samples after round `after`, about
    one a second of game time. p is a species' chance of being drawn for a turn, P its recent success."""
    with urllib.request.urlopen("%s/prevalence?after=%d" % (API, after), timeout=10) as resp:
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
    "scores" (the live scoreboard), "versions": {kind: {"version", "size", "atMs", ...}}, "memory", "text", and in a game
    with species prevalence "prevalence": [{"species", "teamId", "p", "P"}] (p_s: the chance a turn draws the species;
    P_s: its recent pollination success)}"""
    return call("status", afford=afford)


def memory():
    """Your bee's MEMORY as the game holds it: {"value", "bytes", "cap", "version", "error"} (None before your bee has
    one; error: why its last save failed). A flat key-value store: bytes is the sum of each key's bytes and its value's
    JSON bytes. Read only: only your deployed bee writes it, and a new bee version starts with {}."""
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


def try_flower(code, challenges=None, budget="random"):
    """Run a flower on challenges on the game's real runner without submitting it, each call with the hidden budget R
    `budget` (ms; "random": a fresh one per call, as in a game; or a list, one per challenge), which it reads as
    GAME["ms"]: {"ok", "size", "results": [{"c", "r", "rBytes", "rHash", "rPreview", "percent", "budgetMs", "energy",
    "ms", "error"}]} (a response over 4 KB: r None, its size, hash and first 4 KB)."""
    return call("try", kind="flower", code=code, challenges=challenges, budget=budget)


def try_bee(code, rounds=None, flower=None, memory=None):
    """Run a test bee for `rounds` rounds in a garden of just your own flower (`flower` code, else your latest submitted
    one), starting with `memory` as its MEMORY (default {}), with fed(nectar) called after each feed as in a game: {"ok",
    "feeds", "nectar", "pollen", "rounds", "memory" (the test bee's at the end: value, bytes, cap, error), "fed" (whether
    your bee defines fed, how often it ran, its failures), "actions", "problems"}. It never touches your game bee's
    MEMORY."""
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
