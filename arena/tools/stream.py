"""Read the garden's live action stream with code, at your own pace.

Files (see stream/SCHEMA.md):
    stream/actions.jsonl   every action in the game so far, as anyone may see it: one JSON object per line,
                           oldest first. The runner appends new actions about once a second while the game
                           runs, so the file keeps growing. Read it, never write to it.
    stream/mine.jsonl      what only your team sees of the actions of YOUR bee and at YOUR patch (same seq as
                           in actions.jsonl): your bee's printouts ("log"), your programs' versions, why the
                           game ended your bee's visit.
    stream/teams.json      team ids -> names, and which team is yours.

As a library (from a script in your workspace):
    import sys; sys.path.insert(0, "tools")
    from stream import Stream
    s = Stream()
    for a in s.actions(): ...                 # everything so far, oldest first
    for a in s.actions(since_ms=60000): ...   # from game time 1:00 on (jumps there, doesn't read it all)
    for a in s.follow(): ...                  # waits for new actions and yields them as they arrive
    for m in s.mine(): ...                    # your private details (log, versions), by seq
    s.name(team_id), s.me, s.teams, s.last()  # names, your team id, the latest action

From the shell:
    python3 tools/stream.py summary [--since MIN]          per-bee and per-flower counts (compact)
    python3 tools/stream.py tail [-n 20]                   the latest actions, one line each
    python3 tools/stream.py answers CHALLENGE [--since MIN]  what each flower answered to one challenge
    python3 tools/stream.py sql "SELECT ..." [--limit N]   SQL over a local SQLite copy (cache/stream.sqlite,
                                                           brought up to date on every call; table actions)

Times are game time in milliseconds (atMs); --since takes minutes of game time, e.g. --since 0.5.
"""
import json
import os
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Stream:
    def __init__(self, root=ROOT):
        self.root = root
        self.file = os.path.join(root, "stream", "actions.jsonl")
        self.mine_file = os.path.join(root, "stream", "mine.jsonl")
        try:
            with open(os.path.join(root, "stream", "teams.json")) as f:
                t = json.load(f)
        except (OSError, ValueError):
            t = {"teams": {}, "me": None}
        self.teams = t.get("teams", {})
        self.me = t.get("me")

    def name(self, team_id):
        return self.teams.get(team_id, str(team_id)[:8])

    # ---- reading
    def _lines(self, path, offset=0):
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

    def _offset_for(self, since_ms):
        """Byte offset of the first line with atMs >= since_ms (binary search: lines are in time order)."""
        if not os.path.exists(self.file):
            return 0
        size = os.path.getsize(self.file)
        lo, hi = 0, size
        with open(self.file, "rb") as f:
            while hi - lo > 4096:
                mid = (lo + hi) // 2
                f.seek(mid)
                f.readline()
                pos = f.tell()
                line = f.readline()
                try:
                    t = json.loads(line)["atMs"]
                except (ValueError, KeyError):
                    hi = mid
                    continue
                if t < since_ms:
                    lo = pos
                else:
                    hi = mid
            f.seek(lo)
            if lo:
                f.readline()
            return f.tell() if lo else 0

    def actions(self, since_ms=None, since_seq=None):
        """Every action so far (dicts), oldest first; optionally only from game time since_ms or after seq since_seq."""
        offset = self._offset_for(since_ms) if since_ms else 0
        for a in self._lines(self.file, offset):
            if since_ms is not None and a["atMs"] < since_ms:
                continue
            if since_seq is not None and a["seq"] <= since_seq:
                continue
            yield a

    def mine(self):
        """Your private details of your own bee's and patch's actions: {seq, atMs, beeVersion, flowerVersion, log, ...}."""
        return self._lines(self.mine_file)

    def last(self):
        """The latest action, or None."""
        if not os.path.exists(self.file):
            return None
        with open(self.file, "rb") as f:
            f.seek(max(0, os.path.getsize(self.file) - 65536))
            lines = [l for l in f.read().split(b"\n") if l.strip()]
        for raw in reversed(lines):
            try:
                return json.loads(raw)
            except ValueError:
                continue
        return None

    def follow(self, poll=0.25, from_start=False):
        """Yield new actions as the runner appends them (blocks between them). Starts at the end of the file
        unless from_start. Stop it yourself (break) when you're done."""
        offset = 0 if from_start else (os.path.getsize(self.file) if os.path.exists(self.file) else 0)
        buf = b""
        while True:
            if os.path.exists(self.file) and os.path.getsize(self.file) > offset:
                with open(self.file, "rb") as f:
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


def summary(s, since_ms):
    bees, flowers = {}, {}
    last_visit = {}
    first_t = last_t = None
    n = 0
    for a in s.actions(since_ms=since_ms):
        n += 1
        first_t = a["atMs"] if first_t is None else first_t
        last_t = a["atMs"]
        b = bees.setdefault(a["bee"], {"visits": 0, "asks": 0, "feeds": 0, "nectar": 0, "errors": 0, "cs": {}})
        f = flowers.setdefault((a["patch"], a["kind"]), {"visits": 0, "asks": 0, "feeds": 0, "bees": set(), "errors": 0, "ms": 0.0})
        if last_visit.get(a["bee"]) != a["visit"]:
            last_visit[a["bee"]] = a["visit"]
            b["visits"] += 1
            f["visits"] += 1
        act = a["action"]
        if act == "ask":
            b["asks"] += 1
            f["asks"] += 1
            f["ms"] += a.get("ms") or 0
            k = json.dumps(a.get("c"))
            b["cs"][k] = b["cs"].get(k, 0) + 1
            if a.get("by") == "flower":
                f["errors"] += 1
        elif act == "feed":
            b["feeds"] += 1
            f["feeds"] += 1
            f["bees"].add(a["bee"])
            if a.get("nectar"):
                b["nectar"] += 1
        elif act == "error":
            b["errors"] += 1
    if not n:
        print("no actions yet" + (" in that stretch" if since_ms else ""))
        return
    print("%d actions, game time %s-%s" % (n, _mmss(first_t), _mmss(last_t)))
    me = s.me
    print("\nbees:   team                 visits  asks feeds nectar  prec errors distinct-challenges top-challenge")
    for t, b in sorted(bees.items(), key=lambda x: s.name(x[0])):
        top = max(b["cs"].items(), key=lambda x: x[1]) if b["cs"] else ("-", 0)
        prec = "%.2f" % (b["nectar"] / b["feeds"]) if b["feeds"] else "  - "
        print("  %s %-20s %6d %5d %5d %6d  %s %6d %8d            %s x%d" % ("*" if t == me else " ", s.name(t)[:20], b["visits"], b["asks"], b["feeds"],
                                                                            b["nectar"], prec, b["errors"], len(b["cs"]), _short(json.loads(top[0]) if top[0] != "-" else "-", 20), top[1]))
    print("\nflowers: team                 kind    visits  asks feeds feed-rate bees-fed errors mean-ms")
    for (t, k), f in sorted(flowers.items(), key=lambda x: (s.name(x[0][0]), x[0][1])):
        rate = "%.2f" % (f["feeds"] / f["visits"]) if f["visits"] else "  - "
        ms = "%.1f" % (f["ms"] / f["asks"]) if f["asks"] else "-"
        print("  %s %-20s %-7s %6d %5d %5d %9s %8d %6d %7s" % ("*" if t == me else " ", s.name(t)[:20], k, f["visits"], f["asks"], f["feeds"], rate, len(f["bees"]), f["errors"], ms))
    print("\n(* = your team; feed-rate = feeds per visit; prec = nectar per feed)")


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
        if what == "ask":
            what = "ask c=%s r=%s%s" % (_short(a.get("c")), _short(a.get("r")), " (%.1fms)" % a["ms"] if a.get("ms") is not None else "")
        elif what == "feed":
            what = "feed nectar=%s" % a.get("nectar")
        if a.get("error"):
            what += " error(%s): %s" % (a.get("by"), a["error"][:60])
        print("#%d %s round %s  %s -> %s/%s visit %s  %s" % (a["seq"], _mmss(a["atMs"]), a.get("round"), s.name(a["bee"])[:16], s.name(a["patch"])[:16], a["kind"], a["visit"], what))


def answers(s, challenge, since_ms):
    out = {}
    for a in s.actions(since_ms=since_ms):
        if a["action"] != "ask" or a.get("c") != challenge:
            continue
        d = out.setdefault((a["patch"], a["kind"]), {})
        k = json.dumps(a.get("r"))
        e = d.setdefault(k, [0, a["atMs"]])
        e[0] += 1
    if not out:
        print("nobody has asked %s%s" % (json.dumps(challenge), " in that stretch" if since_ms else ""))
        return
    for (t, kind), d in sorted(out.items(), key=lambda x: (s.name(x[0][0]), x[0][1])):
        print("%s%s/%s:" % ("* " if t == s.me else "", s.name(t), kind))
        for k, (cnt, t0) in sorted(d.items(), key=lambda x: -x[1][0])[:8]:
            print("    %s  x%d (first at %s)" % (_short(json.loads(k), 70), cnt, _mmss(t0)))
        if len(d) > 8:
            print("    ... %d more different answers" % (len(d) - 8))


def sql(s, query, limit):
    os.makedirs(os.path.join(s.root, "cache"), exist_ok=True)
    db = sqlite3.connect(os.path.join(s.root, "cache", "stream.sqlite"))
    db.execute("""CREATE TABLE IF NOT EXISTS actions (seq INTEGER PRIMARY KEY, at_ms INTEGER, round INTEGER, bee TEXT, bee_name TEXT,
                  patch TEXT, patch_name TEXT, kind TEXT, action TEXT, visit INTEGER, c TEXT, r TEXT, after INTEGER, nectar INTEGER,
                  ms REAL, error TEXT, by TEXT)""")
    db.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER)")
    row = db.execute("SELECT v FROM meta WHERE k = 'offset'").fetchone()
    offset = row[0] if row else 0
    if os.path.exists(s.file) and os.path.getsize(s.file) < offset:
        offset = 0
        db.execute("DELETE FROM actions")
    rows = []
    with open(s.file, "rb") if os.path.exists(s.file) else open(os.devnull, "rb") as f:
        f.seek(offset)
        for raw in f:
            if not raw.endswith(b"\n"):
                break
            offset += len(raw)
            try:
                a = json.loads(raw)
            except ValueError:
                continue
            rows.append((a["seq"], a["atMs"], a.get("round"), a["bee"], s.name(a["bee"]), a["patch"], s.name(a["patch"]), a["kind"], a["action"],
                         a["visit"], json.dumps(a.get("c")) if "c" in a else None, json.dumps(a.get("r")) if "r" in a else None,
                         1 if a.get("after") else 0, None if a.get("nectar") is None else int(a["nectar"]), a.get("ms"), a.get("error"), a.get("by")))
    db.executemany("INSERT OR REPLACE INTO actions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    db.execute("INSERT OR REPLACE INTO meta VALUES ('offset', ?)", (offset,))
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
    cmd = args[0] if args else "summary"
    if cmd == "summary":
        summary(s, _since(args))
    elif cmd == "tail":
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
            sys.exit('usage: stream.py sql "SELECT bee_name, count(*) FROM actions GROUP BY 1"')
        sql(s, args[1], int(args[args.index("--limit") + 1]) if "--limit" in args else 200)
    else:
        print(__doc__)
