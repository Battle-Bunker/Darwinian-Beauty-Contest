"""The garden, for your scaffold: a program of your own that runs outside the game engine for the rest of the game and
reacts to what happens by changing your programs itself (start it with tools/scaffold.py). Sessions can use it too.

    import sys; sys.path.insert(0, "tools")
    import garden

    for a in garden.follow():                       # each new action as it happens (waits between them)
        if a["action"] == "ask" and a["kind"] == "cosmos" and a["patch"] != garden.ME:
            ...                                     # a rival cosmos answered a["r"] to a["c"]
    s = garden.status()                             # clock, round, scores; YOUR budgets (exact) and versions
    m = garden.measure("orchid", code)              # free: {"ok", "size", "cost", "available", "errors"}
    r = garden.submit("orchid", code)               # live at once if affordable; else r["ok"] is False and
                                                    # r["wait_s"] says how long until it is (None: never, too big)
    garden.wait_for_budget("orchid", 300)           # sleep until 300 nodes of change are available
    code = garden.live("orchid")                    # the source of your orchid playing now

The change budget is enforced by the server: a submission you can't afford is refused, nothing else happens.
Everything goes through the game runner (tools/_runner.py): no password or token is ever needed here.

Actions are dicts (stream/SCHEMA.md): seq, atMs, round, bee, patch, kind (cosmos/orchid), visit, action
(arrive/ask/feed/leave/error), c and r for an ask, nectar for a feed. An "arrive" says which flower a bee was just
dealt, before its first ask. Your team sees all of it; your bee sees none of it unless
you put it into its code. Team ids: garden.ME is yours, garden.TEAMS maps ids to names.
"""
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _runner import ROOT, call  # noqa: E402
from stream import Stream  # noqa: E402

_s = Stream(ROOT)
ME = _s.me
TEAMS = _s.teams
KINDS = ("cosmos", "orchid", "bee")
try:
    with open(os.path.join(ROOT, "config.json")) as _f:
        CONFIG = json.load(_f)
except (OSError, ValueError):
    CONFIG = {}
API = CONFIG.get("public_api")


def name(team_id):
    """A team's name from its id."""
    return TEAMS.get(team_id, str(team_id)[:8])


# ---------------------------------------------------------------- the stream

def mine():
    """Your own bee's and patch's actions as your team sees them (with kind, your timings, versions, printouts)."""
    return _s.mine()


def actions(after=0, since_ms=None):
    """Every action so far with seq > after (or from game time since_ms on), oldest first."""
    return _s.actions(since_ms=since_ms, since_seq=after or None)


def last():
    """The latest action, or None."""
    return _s.last()


def follow(after=None, poll=0.1):
    """Yield each new action as the runner appends it to stream/actions.jsonl (about once a second). Starts after
    seq `after`, or at the end of what's there now. Never returns: break out of it yourself."""
    if after is None:
        a = _s.last()
        after = a["seq"] if a else 0
    for a in _s.follow(poll=poll, from_start=True):
        if a["seq"] > after:
            after = a["seq"]
            yield a


def _sse_messages(after):
    with urllib.request.urlopen("%s/events?after=%d" % (API, after), timeout=30) as resp:
        for raw in resp:
            if raw.startswith(b"data: "):
                yield json.loads(raw[6:])


def _ws_messages(after):
    """The game's WebSocket (the same messages as the event stream), with nothing but the standard library."""
    url = "%s/ws?after=%d" % (API.replace("http", "ws", 1), after)
    hostport, path = url.split("://", 1)[1].split("/", 1)
    host, _, port = hostport.partition(":")
    sock = socket.create_connection((host, int(port or 80)), timeout=60)
    try:
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall(("GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                raise ConnectionError("no handshake")
            buf += chunk
        head, buf = buf.split(b"\r\n\r\n", 1)
        if b" 101" not in head.split(b"\r\n")[0]:
            raise ConnectionError(head.split(b"\r\n")[0].decode(errors="replace"))

        def read(n):
            nonlocal buf
            while len(buf) < n:
                chunk = sock.recv(65536)
                if not chunk:
                    raise ConnectionError("closed")
                buf += chunk
            out, buf = buf[:n], buf[n:]
            return out

        def send(op, data=b""):  # client frames are masked
            mask = os.urandom(4)
            sock.sendall(bytes([0x80 | op, 0x80 | len(data)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

        message = b""
        while True:
            b1, b2 = read(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", read(8))[0]
            mask = read(4) if b2 & 0x80 else None
            data = read(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            op = b1 & 0x0F
            if op == 8:
                return
            if op == 9:
                send(0xA, data[:125])
            elif op in (0, 1, 2):
                message += data
                if b1 & 0x80:
                    yield json.loads(message)
                    message = b""
    finally:
        sock.close()


def follow_live(after=None, transport="sse"):
    """Like follow(), but straight from the game's public API: lower latency than the file (a few times a second).
    transport: "sse" (Server-Sent Events) or "ws" (the WebSocket). Reconnects if the connection drops."""
    if after is None:
        a = _s.last()
        after = a["seq"] if a else 0
    messages = _ws_messages if transport == "ws" else _sse_messages
    while True:
        try:
            for msg in messages(after):
                for a in msg.get("actions") or []:
                    if a["seq"] > after:
                        after = a["seq"]
                        yield a
        except Exception:
            time.sleep(1)


def scores():
    """The live numbers from the public API: status, clockMs, endMs, round, scores, recent (last 5 minutes), ledgers."""
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
    "scores", "recent", "versions": {kind: {"version", "size", "atMs", ...}}, "text"}"""
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


def try_program(kind, code, challenges=None):
    """Run it on the game's real runner without submitting: a flower on challenges, a bee on your own flowers."""
    return call("try", kind=kind, code=code, challenges=challenges)


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
