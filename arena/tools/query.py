"""Ask the game's history, with the same typed query builder your programs use on HISTORY (tools/history.py; the
whole interface is in README.md, "Querying history").

    python3 tools/query.py 'turns.my_bee().eq("fed", True).group_by("flower").sum("nectar")'
    python3 tools/query.py 'turns.rounds(100, 200).eq("flower", 2).order_by("round", desc=True).limit(5)'
    python3 tools/query.py 'scores.order_by("fitness", desc=True)'
    python3 tools/query.py 'turns.my_flower().eq("fed", False).sum("energy").value()'

    --local   run it on stream/history.jsonl: exactly what your programs' HISTORY holds (turns only)
    --room    run it across this arena's finished games, fully revealed (the `game` field tells them apart)
    --ast     print the query (JSON) instead of running it
    --json    print the rows as JSON

Without --local or --room it runs on this game, as your team may see it (through the game runner: your private fields
included). Entities: turns, versions (your own during play), teams (your bee's MEMORY is teams.memory), pairs, scores.
A query ends with .rows() unless you end it with .value(), .first() or .ast().

    python3 tools/query.py summary [--local]     per species and per bee: turns, feeds, nectar, pollen, mean percent;
                                                 your own flower's percent, energy, compute and energy lost
    python3 tools/query.py schema                the entities and their fields

From a script:  import sys; sys.path.insert(0, "tools"); import garden
                garden.game.turns.my_bee().count().value()      (or garden.HISTORY, garden.room)
"""
import ast as pyast
import dataclasses
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import garden  # noqa: E402

ENTITIES = ("turns", "versions", "teams", "pairs", "scores")
RUN = ("rows", "value", "first", "ast")
METHODS = {"eq", "ne", "lt", "le", "gt", "ge", "in_", "between", "is_null", "not_null", "rounds", "my_bee", "my_flower", "mine",
           "select", "group_by", "count", "sum", "avg", "min", "max", "order_by", "limit", "offset"} | set(RUN)


def parse(expr):
    """'turns.my_bee().eq("fed", True).count()' -> ("turns", [("my_bee", [], {}), ("eq", ["fed", True], {}), ...]).
    Only builder methods with literal arguments: nothing else is evaluated."""
    node = pyast.parse(expr.strip(), mode="eval").body
    calls = []
    while isinstance(node, pyast.Call):
        if not isinstance(node.func, pyast.Attribute):
            raise ValueError("expected entity.method(...)...")
        m = node.func.attr
        if m not in METHODS:
            raise ValueError("unknown method %r (methods: %s)" % (m, ", ".join(sorted(METHODS))))
        args = [pyast.literal_eval(a) for a in node.args]
        kwargs = {k.arg: pyast.literal_eval(k.value) for k in node.keywords}
        calls.append((m, args, kwargs))
        node = node.func.value
    if not isinstance(node, pyast.Name) or node.id not in ENTITIES:
        raise ValueError("a query starts with an entity: %s" % ", ".join(ENTITIES))
    return node.id, list(reversed(calls))


def build(root, expr):
    entity, calls = parse(expr)
    run = "rows"
    if calls and calls[-1][0] in RUN:
        run = calls.pop()[0]
    q = getattr(root, entity)
    for m, args, kwargs in calls:
        if m in RUN:
            raise ValueError("%s() can only end a query" % m)
        q = getattr(q, m)(*args, **kwargs)
    return q, run


def as_dict(r):
    if dataclasses.is_dataclass(r):
        return dataclasses.asdict(r)
    if hasattr(r, "_asdict"):
        return r._asdict()
    if isinstance(r, dict):
        return r
    return dict(vars(r)) if hasattr(r, "__dict__") else {"value": r}


def short(v, n=24):
    s = v if isinstance(v, str) else json.dumps(v, separators=(",", ":"))
    if isinstance(v, float):
        s = "%.6g" % v
    return s if len(s) <= n else s[: n - 3] + "..."


def table(rows, limit=200):
    rows = [as_dict(r) for r in rows]
    if not rows:
        print("(no rows)")
        return
    cols = list(rows[0].keys())
    cells = [[short(r.get(c)) for c in cols] for r in rows[:limit]]
    widths = [max(len(c), *(len(x[i]) for x in cells)) for i, c in enumerate(cols)]
    print("  ".join(c.ljust(w) for c, w in zip(cols, widths)))
    for x in cells:
        print("  ".join(v.ljust(w) for v, w in zip(x, widths)))
    if len(rows) > limit:
        print("... %d more rows (use limit/offset, or --json)" % (len(rows) - limit))


def root_for(args):
    if "--local" in args:
        return garden.HISTORY
    if "--room" in args:
        return garden.room
    return garden.game


def summary(root, as_json):
    t = root.turns
    me = garden.MY_INDEX
    out = {
        "species": t.group_by("flower").count().rows(),
        "species_fed": t.eq("fed", True).group_by("flower").count().sum("nectar").sum("pollen").avg("percent").rows(),
        "bees": t.group_by("bee").count().rows(),
        "bees_fed": t.eq("fed", True).group_by("bee").count().sum("nectar").rows(),
    }
    if me is not None:
        out["your_flower"] = t.my_flower().count().avg("percent").avg("energy").avg("ms").max("ms").first()
        out["your_flower_lost"] = t.my_flower().eq("fed", False).sum("energy").value()
    if as_json:
        print(json.dumps({k: ([as_dict(r) for r in v] if isinstance(v, (list, tuple)) else (as_dict(v) if v is not None and not isinstance(v, (int, float)) else v))
                          for k, v in out.items()}, indent=1, default=str))
        return
    turns = {r.flower: r.count for r in out["species"]}
    fed = {r.flower: r for r in out["species_fed"]}
    print("species of             visits  feeds  nectar given  pollen given  mean % on feeds")
    for f in sorted(turns):
        x = fed.get(f)
        print("%s %-20s %6d %6d %13s %13s %16s" % ("*" if f == me else " ", garden.name(f)[:20], turns[f], x.count if x else 0,
              short(x.sum_nectar) if x else "-", short(x.sum_pollen) if x else "-", short(x.avg_percent) if x and x.avg_percent is not None else "-"))
    turns = {r.bee: r.count for r in out["bees"]}
    fed = {r.bee: r for r in out["bees_fed"]}
    print("\nbee of                  turns  feeds  nectar got")
    for b in sorted(turns):
        x = fed.get(b)
        print("%s %-20s %6d %6d %11s" % ("*" if b == me else " ", garden.name(b)[:20], turns[b], x.count if x else 0, short(x.sum_nectar) if x else "-"))
    y = out.get("your_flower")
    if y is not None:
        print("\nyour flower: %d visits; mean percent %s, mean energy %s, compute mean %s ms, max %s ms; energy lost to turns without a feed %s"
              % (y.count, short(y.avg_percent), short(y.avg_energy), short(y.avg_ms), short(y.max_ms), short(out["your_flower_lost"])))
    print("(* = your team)")


def schema():
    h = garden._client()
    s = getattr(h, "SCHEMA", None)
    if s is None:
        print("see README.md, \"Querying history\"")
        return
    for name, ent in (s.get("entities") or {}).items():
        print("%s: %s" % (name, ent.get("doc", "")))
        for f in ent.get("fields", []):
            print("    %-18s %-6s %s" % (f.get("python") or f.get("name"), f.get("type"), f.get("doc", "")))


if __name__ == "__main__":
    args = sys.argv[1:]
    words = [a for a in args if not a.startswith("--")]
    as_json = "--json" in args
    if not words:
        print(__doc__)
        sys.exit(0)
    try:
        if words[0] == "summary":
            summary(root_for(args), as_json)
        elif words[0] == "schema":
            schema()
        else:
            q, run = build(root_for(args), words[0])
            if "--ast" in args or run == "ast":
                print(json.dumps(q.ast(), indent=1))
            elif run == "value":
                print(json.dumps(q.value(), default=str))
            elif run == "first":
                r = q.first()
                print(json.dumps(as_dict(r) if r is not None else None, indent=1, default=str))
            else:
                rows = q.rows()
                if as_json:
                    print(json.dumps([as_dict(r) for r in rows], indent=1, default=str))
                else:
                    table(rows)
    except (ValueError, SyntaxError) as e:
        sys.exit("query error: %s" % e)
    except RuntimeError as e:
        sys.exit("the game refused the query: %s" % e)
