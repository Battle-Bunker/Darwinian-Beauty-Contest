"""Your team ledger: one entry per finished turn, exactly what your programs get (stream/ledger.jsonl, kept
up to date by the runner about once a second; stream/SCHEMA.md says what each field is).

    python3 tools/ledger.py summary [--since MIN]   per flower team and per bee team: turns, feeds, feed rate,
                                                    pollinators, mean percent and nectar on feeds; your own
                                                    flower's percent, energy and compute, and energy lost
    python3 tools/ledger.py tail [-n 20]            the latest entries, one line each
    python3 tools/ledger.py mine [--since MIN]      your flower turn by turn bucketed, and your bee's nectar by flower
    python3 tools/ledger.py live [--after SEQ]      ask the runner for the newest entries straight from the game
                                                    (the file can be a second behind)
    add --json for raw output.

From a script:  sys.path.insert(0, "tools"); from stream import Stream; for e in Stream().turns(): ...
"""
import json
import sys
from stream import Stream


def _since_round(args):
    if "--since" in args:
        return int(float(args[args.index("--since") + 1]) * 60000 / 200)
    return None


def _num(x, d=0):
    if x is None:
        return "-"
    if abs(x) >= 1e6:
        return "%.2fM" % (x / 1e6)
    if abs(x) >= 1e4:
        return "%.1fk" % (x / 1e3)
    return ("%." + str(d) + "f") % x


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def summary(s, since_round, as_json=False):
    flowers, bees = {}, {}
    n = 0
    for e in s.turns(since_round=since_round):
        n += 1
        f = flowers.setdefault(e["flower"], {"turns": 0, "feeds": 0, "bees": set(), "percent": [], "nectar": 0.0, "surplus": 0.0, "noResponse": 0})
        b = bees.setdefault(e["bee"], {"turns": 0, "feeds": 0, "flowers": set(), "nectar": 0.0})
        f["turns"] += 1
        b["turns"] += 1
        if e.get("response") is None:
            f["noResponse"] += 1
        if e.get("fed"):
            f["feeds"] += 1
            b["feeds"] += 1
            f["bees"].add(e["bee"])
            b["flowers"].add(e["flower"])
            if e.get("percent") is not None:
                f["percent"].append(e["percent"])
            f["nectar"] += e.get("nectar") or 0
            f["surplus"] += e.get("surplus") or 0
            b["nectar"] += e.get("nectar") or 0
    if as_json:
        print(json.dumps({"turns": n, "flowers": {s.name(k): dict(v, bees=len(v["bees"]), percent=_mean(v["percent"])) for k, v in flowers.items()},
                          "bees": {s.name(k): dict(v, flowers=len(v["flowers"])) for k, v in bees.items()}}, indent=1, default=list))
        return
    if not n:
        print("no turns yet" + (" in that stretch" if since_round else ""))
        return
    me = s.my_index
    print("%d turns%s" % (n, " from round %d" % since_round if since_round else ""))
    print("\nflowers: team                 visits feeds feed-rate pollinators mean%%-fed nectar-paid surplus-kept no-response")
    for t, f in sorted(flowers.items(), key=lambda x: x[0]):
        print("  %s %-20s %6d %5d %9s %11d %9s %11s %12s %11d" % ("*" if t == me else " ", s.name(t)[:20], f["turns"], f["feeds"],
              "%.2f" % (f["feeds"] / f["turns"]) if f["turns"] else "-", len(f["bees"]), _num(_mean(f["percent"]), 1), _num(f["nectar"]), _num(f["surplus"]), f["noResponse"]))
    print("\nbees:    team                 turns feeds feed-rate flowers-fed nectar  nectar/feed")
    for t, b in sorted(bees.items(), key=lambda x: x[0]):
        print("  %s %-20s %6d %5d %9s %11d %7s %11s" % ("*" if t == me else " ", s.name(t)[:20], b["turns"], b["feeds"], "%.2f" % (b["feeds"] / b["turns"]) if b["turns"] else "-",
              len(b["flowers"]), _num(b["nectar"]), _num(b["nectar"] / b["feeds"]) if b["feeds"] else "-"))
    mine(s, since_round, brief=True)
    print("\n(* = your team; percent, nectar and surplus as your team may see them: see stream/SCHEMA.md)")


def mine(s, since_round, brief=False, as_json=False):
    me = s.my_index
    at_me = [e for e in s.turns(since_round=since_round) if e["flower"] == me]
    by_me = [e for e in s.turns(since_round=since_round) if e["bee"] == me]
    fed = [e for e in at_me if e.get("fed")]
    unfed = [e for e in at_me if not e.get("fed")]
    out = {
        "flower": {"turns": len(at_me), "feeds": len(fed), "meanPercent": _mean([e.get("percent") for e in at_me]),
                   "meanPercentFed": _mean([e.get("percent") for e in fed]), "meanEnergy": _mean([e.get("energy") for e in at_me]),
                   "energyLost": sum(e.get("energy") or 0 for e in unfed), "nectarPaid": sum(e.get("nectar") or 0 for e in fed),
                   "surplus": sum(e.get("surplus") or 0 for e in fed), "meanMs": _mean([e.get("ms") for e in at_me]),
                   "maxMs": max([e.get("ms") for e in at_me if e.get("ms") is not None], default=None),
                   "noResponse": sum(1 for e in at_me if e.get("response") is None), "ownBeeTurns": sum(1 for e in at_me if e["bee"] == me)},
        "bee": {"turns": len(by_me), "feeds": sum(1 for e in by_me if e.get("fed")), "nectar": sum(e.get("nectar") or 0 for e in by_me if e.get("fed")),
                "byFlower": {}},
    }
    for e in by_me:
        x = out["bee"]["byFlower"].setdefault(s.name(e["flower"]), {"turns": 0, "feeds": 0, "nectar": 0.0})
        x["turns"] += 1
        if e.get("fed"):
            x["feeds"] += 1
            x["nectar"] += e.get("nectar") or 0
    if as_json:
        print(json.dumps(out, indent=1))
        return
    f = out["flower"]
    print("\nyour flower: %d visits, %d feeds; mean percent %s (on feeds %s); mean energy %s; energy lost to turns without a feed %s;"
          % (f["turns"], f["feeds"], _num(f["meanPercent"], 1), _num(f["meanPercentFed"], 1), _num(f["meanEnergy"]), _num(f["energyLost"])))
    print("             nectar paid %s, surplus kept %s; compute mean %s ms, max %s ms; %d turns with no response; %d visits by your own bee"
          % (_num(f["nectarPaid"]), _num(f["surplus"]), _num(f["meanMs"], 2), _num(f["maxMs"], 2), f["noResponse"], f["ownBeeTurns"]))
    b = out["bee"]
    print("your bee:    %d turns, %d feeds, %s nectar" % (b["turns"], b["feeds"], _num(b["nectar"])))
    if not brief:
        for name, x in sorted(b["byFlower"].items()):
            print("    at %-20s %5d turns %4d feeds %10s nectar" % (name[:20], x["turns"], x["feeds"], _num(x["nectar"])))


def tail(s, n):
    rows = list(s.turns())[-n:]
    for e in rows:
        extra = []
        for k in ("percent", "energy", "nectar", "surplus", "ms"):
            if e.get(k) is not None:
                extra.append("%s=%s" % (k, _num(e[k], 2 if k == "ms" else 0)))
        print("#%s round %s  %s bee -> %s flower  c=%s r=%s  %s  %s" % (e.get("seq"), e.get("round"), s.name(e["bee"])[:14], s.name(e["flower"])[:14],
              json.dumps(e.get("challenge"))[:30], json.dumps(e.get("response"))[:30], "FED" if e.get("fed") else "left", " ".join(extra)))


def live(after, as_json):
    from _runner import call, show
    r = call("ledger", after=after)
    if as_json or not r.get("ok"):
        show(r, as_json)
        return
    print(r.get("text", ""))
    s = Stream()
    for e in (r.get("entries") or [])[-20:]:
        print("  #%s round %s  %s -> %s  %s" % (e.get("seq"), e.get("round"), s.name(e["bee"]), s.name(e["flower"]), "FED" if e.get("fed") else "left"))


if __name__ == "__main__":
    args = sys.argv[1:]
    s = Stream()
    cmd = args[0] if args and not args[0].startswith("-") else "summary"
    as_json = "--json" in args
    if cmd == "summary":
        summary(s, _since_round(args), as_json)
    elif cmd == "mine":
        mine(s, _since_round(args), as_json=as_json)
    elif cmd == "tail":
        tail(s, int(args[args.index("-n") + 1]) if "-n" in args else 20)
    elif cmd == "live":
        live(int(args[args.index("--after") + 1]) if "--after" in args else 0, as_json)
    else:
        print(__doc__)
