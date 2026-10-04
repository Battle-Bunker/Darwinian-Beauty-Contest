"""The game's files in stream/, read with code at your own pace (stream/SCHEMA.md says what each holds).

    stream/history.jsonl   YOUR TEAM'S HISTORY: one turn record per finished turn, oldest first, exactly what your
                           programs see as HISTORY.turns (plus "seq"). Teams are indices 0..N-1.
    stream/actions.jsonl   the public stream: every arrival and every turn's end as anyone sees it. Teams are ids.
    stream/mine.jsonl      your own bee's and flower's actions with your private fields and your bee's printouts.
    stream/teams.json      ids -> names, "names" in index order, "me" (your id) and "myIndex".
The runner appends to them about once a second while the game runs. Read them, never write to them.
To ask questions of the history, use tools/query.py (or garden.HISTORY in a script): the same typed queries your
programs run on HISTORY.

As a library (from a script in your workspace):
    import sys; sys.path.insert(0, "tools")
    from stream import Stream
    s = Stream()
    for t in s.turns(): ...                  # your history, oldest first: dicts with the Python field names
    for t in s.follow(): ...                 # waits for new turns and yields them as they arrive
    for a in s.actions(): ...                # the public stream (arrivals too)
    for a in s.mine(): ...                   # your own actions with your private fields and printouts
    s.name(i), s.my_index, s.n, s.last()     # names (by index or id), your index, team count, the latest turn

From the shell:
    python3 tools/stream.py tail [-n 20]     the latest public actions, one line each
"""
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SNAKE = re.compile(r"(?<!^)(?=[A-Z])")


def snake(record):
    """A turn record with the Python field names (atMs -> at_ms, flowerVersion -> flower_version, ...)."""
    return {_SNAKE.sub("_", k).lower(): v for k, v in record.items()}


def _lines(path, offset=0):
    if not os.path.exists(path):
        return
    with open(path, "rb") as f:
        f.seek(offset)
        for raw in f:
            if not raw.endswith(b"\n"):
                break  # the runner is still writing this line
            try:
                yield json.loads(raw)
            except ValueError:
                continue


def _last_line(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        f.seek(max(0, os.path.getsize(path) - 65536))
        lines = [l for l in f.read().split(b"\n") if l.strip()]
    for raw in reversed(lines):
        try:
            return json.loads(raw)
        except ValueError:
            continue
    return None


def _follow(path, poll=0.25, from_start=False):
    offset = 0 if from_start else (os.path.getsize(path) if os.path.exists(path) else 0)
    buf = b""
    while True:
        if os.path.exists(path) and os.path.getsize(path) > offset:
            with open(path, "rb") as f:
                f.seek(offset)
                data = f.read()
            offset += len(data)
            buf += data
            *lines, buf = buf.split(b"\n")
            for raw in lines:
                if raw.strip():
                    try:
                        yield json.loads(raw)
                    except ValueError:
                        pass
        else:
            time.sleep(poll)


class Stream:
    def __init__(self, root=ROOT):
        self.root = root
        d = os.path.join(root, "stream")
        self.history_file = os.path.join(d, "history.jsonl")
        self.file = os.path.join(d, "actions.jsonl")
        self.mine_file = os.path.join(d, "mine.jsonl")
        self.teams_file = os.path.join(d, "teams.json")
        self._t = {}
        self.refresh()

    def refresh(self):
        """Re-read stream/teams.json while the team indices aren't known yet (in the lobby they aren't: the runner
        completes the file when the game starts). Once known they never change."""
        if self._t.get("participants"):
            return
        try:
            with open(self.teams_file) as f:
                self._t = json.load(f)
        except (OSError, ValueError):
            pass

    def _get(self, key, default):
        if not self._t.get("participants"):
            self.refresh()
        v = self._t.get(key)
        return default if v is None else v

    teams = property(lambda self: self._get("teams", {}))
    me = property(lambda self: self._get("me", None))
    names = property(lambda self: self._get("names", []))
    participants = property(lambda self: self._get("participants", []))
    my_index = property(lambda self: self._get("myIndex", None) if self._get("participants", []) else None)
    n = property(lambda self: len(self._get("participants", [])))

    def name(self, team):
        """A team's name from its index or its id."""
        if isinstance(team, int) and 0 <= team < len(self.names):
            return self.names[team]
        return self.teams.get(team, str(team)[:8])

    def index(self, team_id):
        return self.participants.index(team_id) if team_id in self.participants else None

    # ---- your history (turn records)
    def records(self):
        """The raw turn records of stream/history.jsonl (canonical field names, as the API gives them)."""
        return _lines(self.history_file)

    def turns(self, since_round=None, since_seq=None):
        """Your history (dicts with the Python field names), oldest first; optionally from round since_round or after
        seq since_seq."""
        for e in _lines(self.history_file):
            if since_round is not None and e.get("round", 0) < since_round:
                continue
            if since_seq is not None and e.get("seq", 0) <= since_seq:
                continue
            yield snake(e)

    def last(self):
        """The latest turn, or None."""
        e = _last_line(self.history_file)
        return snake(e) if e else None

    def follow(self, poll=0.25, from_start=False):
        """Yield new turns (Python field names) as the runner appends them; blocks between them. Starts at the end of
        the file unless from_start. Stop it yourself (break) when you're done."""
        for e in _follow(self.history_file, poll, from_start):
            yield snake(e)

    # ---- the public stream and your own actions
    def actions(self, since_ms=None, since_seq=None):
        """The public stream (dicts), oldest first; optionally from game time since_ms or after seq since_seq."""
        for a in _lines(self.file):
            if since_ms is not None and a.get("atMs", 0) < since_ms:
                continue
            if since_seq is not None and a.get("seq", 0) <= since_seq:
                continue
            yield a

    def follow_actions(self, poll=0.25, from_start=False):
        return _follow(self.file, poll, from_start)

    def mine(self):
        """Your own bee's and flower's actions as your team sees them (with ms, beeMs, versions, log)."""
        return _lines(self.mine_file)


# ---------------------------------------------------------------- command line

def _short(v, n=40):
    s = json.dumps(v, separators=(",", ":"))
    return s if len(s) <= n else s[: n - 3] + "..."


def _mmss(ms):
    s = int(ms // 1000)
    return "%d:%02d" % (s // 60, s % 60)


def tail(s, n):
    rows = []
    if os.path.exists(s.file):
        with open(s.file, "rb") as f:
            size = os.path.getsize(s.file)
            back = min(size, 2000 * (n + 1))
            f.seek(size - back)
            for raw in f.read().split(b"\n")[-(n + 1):]:
                try:
                    rows.append(json.loads(raw))
                except ValueError:
                    pass
    for a in rows[-n:]:
        what = a["action"]
        if what != "arrive":
            what += " c=%s r=%s" % (_short(a.get("c")), _short(a.get("r")))
        if a.get("action") == "feed" and a.get("nectar") is not None:
            what += " percent=%s energy=%s nectar=%s pollen=%s" % (a.get("percent"), a.get("energy"), a.get("nectar"), a.get("pollen"))
        print("#%d %s round %s  %s bee -> %s flower (turn %s)  %s" % (a["seq"], _mmss(a.get("atMs", 0)), a.get("round"), s.name(a["bee"])[:16],
                                                                  s.name(a["flower"])[:16], a.get("turn"), what))


if __name__ == "__main__":
    args = sys.argv[1:]
    cmd = args[0] if args else "tail"
    if cmd == "tail":
        tail(Stream(), int(args[args.index("-n") + 1]) if "-n" in args else 20)
    else:
        print(__doc__)
