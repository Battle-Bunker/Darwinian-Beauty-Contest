"""Read the game with code, at your own pace (see stream/SCHEMA.md).

Files:
    stream/ledger.jsonl    YOUR TEAM LEDGER: one entry per finished turn, oldest first, exactly what your
                           programs get as `ledger` (plus "seq"). Teams are indices 0..N-1.
    stream/actions.jsonl   the public stream: every arrival and every turn's end as anyone sees it. Teams are ids.
    stream/mine.jsonl      your own bee's and flower's actions with your private fields and your bee's printouts.
    stream/teams.json      ids -> names, "names" in index order, "me" (your id) and "myIndex".
The runner appends to them about once a second while the game runs. Read them, never write to them.

As a library (from a script in your workspace):
    import sys; sys.path.insert(0, "tools")
    from stream import Stream
    s = Stream()
    for e in s.turns(): ...                  # your team ledger, oldest first
    for e in s.turns(since_round=300): ...   # from round 300 on
    for e in s.follow(): ...                 # waits for new ledger entries and yields them as they arrive
    for a in s.actions(): ...                # the public stream (arrivals too)
    for a in s.mine(): ...                   # your own actions with your private fields
    s.name(i), s.my_index, s.n, s.last()     # names (by index or id), your index, team count, latest entry

From the shell:
    python3 tools/stream.py tail [-n 20]                   the latest public actions, one line each
    python3 tools/stream.py answers CHALLENGE [--since MIN]  what each flower answered to one challenge
    python3 tools/stream.py sql "SELECT ..." [--limit N]   SQL over a local SQLite copy (cache/stream.sqlite,
                                                           brought up to date on every call): table turns (your
                                                           ledger) and table actions (the public stream)
    python3 tools/ledger.py summary|tail|mine|live         your team ledger, summarised (tools/ledger.py)

--since takes minutes of game time, e.g. --since 0.5 (a round is 200 ms).
"""
import json
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


class Stream:
    def __init__(self, root=ROOT):
        self.root = root
        d = os.path.join(root, "stream")
        self.ledger_file = os.path.join(d, "ledger.jsonl")
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
        """A team's name from its ledger index or its id."""
        if isinstance(team, int) and 0 <= team < len(self.names):
            return self.names[team]
        return self.teams.get(team, str(team)[:8])

    def index(self, team_id):
        return self.participants.index(team_id) if team_id in self.participants else None

    # ---- the team ledger
    def turns(self, since_round=None, since_seq=None):
        """Your team ledger (dicts), oldest first; optionally from round since_round or after seq since_seq."""
        for e in _lines(self.ledger_file):
            if since_round is not None and e.get("round", 0) < since_round:
                continue
            if since_seq is not None and e.get("seq", 0) <= since_seq:
                continue
            yield e

    def last(self):
        """The latest ledger entry, or None."""
        return _last_line(self.ledger_file)

    def follow(self, poll=0.25, from_start=False, path=None):
        """Yield new ledger entries (or lines of another stream file) as the runner appends them; blocks between them.
        Starts at the end of the file unless from_start. Stop it yourself (break) when you're done."""
        path = path or self.ledger_file
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
        return self.follow(poll, from_start, self.file)

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


def _since(args):
    if "--since" in args:
        return float(args[args.index("--since") + 1]) * 60000
    return None


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
            what += " percent=%s energy=%s nectar=%s surplus=%s" % (a.get("percent"), a.get("energy"), a.get("nectar"), a.get("surplus"))
        print("#%d %s round %s  %s bee -> %s flower (turn %s)  %s" % (a["seq"], _mmss(a.get("atMs", 0)), a.get("round"), s.name(a["bee"])[:16],
                                                                  s.name(a["flower"])[:16], a.get("turn"), what))


def answers(s, challenge, since_ms):
    out = {}
    for a in s.actions(since_ms=since_ms):
        if a["action"] == "arrive" or a.get("c") != challenge:
            continue
        d = out.setdefault(a["flower"], {})
        k = json.dumps(a.get("r"))
        e = d.setdefault(k, [0, a.get("atMs", 0), 0])
        e[0] += 1
        if a["action"] == "feed":
            e[2] += 1
    if not out:
        print("nobody has asked %s%s" % (json.dumps(challenge), " in that stretch" if since_ms else ""))
        return
    for t, d in sorted(out.items(), key=lambda x: s.name(x[0])):
        print("%s%s's flower:" % ("* " if t == s.me else "", s.name(t)))
        for k, (cnt, t0, fed) in sorted(d.items(), key=lambda x: -x[1][0])[:8]:
            print("    %s  x%d, fed %d (first at %s)" % (_short(json.loads(k), 70), cnt, fed, _mmss(t0)))
        if len(d) > 8:
            print("    ... %d more different answers" % (len(d) - 8))


def sql(s, query, limit):
    os.makedirs(os.path.join(s.root, "cache"), exist_ok=True)
    db = sqlite3.connect(os.path.join(s.root, "cache", "stream.sqlite"))
    db.execute("""CREATE TABLE IF NOT EXISTS turns (seq INTEGER PRIMARY KEY, round INTEGER, bee INTEGER, bee_name TEXT, flower INTEGER,
                  flower_name TEXT, challenge TEXT, response TEXT, fed INTEGER, nectar REAL, percent REAL, energy REAL, ms REAL, surplus REAL)""")
    db.execute("""CREATE TABLE IF NOT EXISTS actions (seq INTEGER PRIMARY KEY, at_ms INTEGER, round INTEGER, turn INTEGER, bee TEXT, bee_name TEXT,
                  flower TEXT, flower_name TEXT, action TEXT, c TEXT, r TEXT, percent REAL, energy REAL, nectar REAL, surplus REAL)""")
    db.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER)")

    def load(path, key, table, row):
        r = db.execute("SELECT v FROM meta WHERE k = ?", (key,)).fetchone()
        offset = r[0] if r else 0
        if os.path.exists(path) and os.path.getsize(path) < offset:
            offset = 0
            db.execute("DELETE FROM %s" % table)
        rows = []
        if os.path.exists(path):
            with open(path, "rb") as f:
                f.seek(offset)
                for raw in f:
                    if not raw.endswith(b"\n"):
                        break
                    offset += len(raw)
                    try:
                        rows.append(row(json.loads(raw)))
                    except (ValueError, KeyError):
                        continue
        if rows:
            db.executemany("INSERT OR REPLACE INTO %s VALUES (%s)" % (table, ",".join("?" * len(rows[0]))), rows)
        db.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, offset))

    j = lambda v: None if v is None else json.dumps(v)
    load(s.ledger_file, "ledger", "turns", lambda e: (e["seq"], e.get("round"), e["bee"], s.name(e["bee"]), e["flower"], s.name(e["flower"]),
                                                      j(e.get("challenge")), j(e.get("response")), 1 if e.get("fed") else 0, e.get("nectar"),
                                                      e.get("percent"), e.get("energy"), e.get("ms"), e.get("surplus")))
    load(s.file, "actions", "actions", lambda a: (a["seq"], a.get("atMs"), a.get("round"), a.get("turn"), a["bee"], s.name(a["bee"]), a["flower"],
                                                  s.name(a["flower"]), a["action"], j(a.get("c")), j(a.get("r")), a.get("percent"), a.get("energy"),
                                                  a.get("nectar"), a.get("surplus")))
    db.commit()
    cur = db.execute(query)
    names = [d[0] for d in cur.description] if cur.description else []
    if names:
        print("\t".join(names))
    for i, r in enumerate(cur):
        if i >= limit:
            print("... (more rows: use --limit)")
            break
        print("\t".join("" if x is None else str(x) for x in r))


if __name__ == "__main__":
    args = sys.argv[1:]
    s = Stream()
    cmd = args[0] if args else "tail"
    if cmd == "tail":
        tail(s, int(args[args.index("-n") + 1]) if "-n" in args else 20)
    elif cmd == "answers":
        if len(args) < 2:
            sys.exit("usage: stream.py answers CHALLENGE (a JSON value, e.g. 42 or '\"abc\"')")
        try:
            c = json.loads(args[1])
        except ValueError:
            c = args[1]
        answers(s, c, _since(args))
    elif cmd == "sql":
        if len(args) < 2:
            sys.exit('usage: stream.py sql "SELECT flower_name, avg(fed) FROM turns GROUP BY 1"')
        sql(s, args[1], int(args[args.index("--limit") + 1]) if "--limit" in args else 200)
    else:
        print(__doc__)
