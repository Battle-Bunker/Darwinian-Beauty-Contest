# Runs the generated Python query client (vendor/query/history.py) for the tests. Reads one JSON job on
# stdin and prints one JSON result:
#   {"mode": "run", "entity", "records", "team", "queries": [ast, ...], "split"?: n}
#       -> [{"rows": [...]} | {"error": "..."}, ...]: each AST run by Table.run (turns: through local(), the
#          first `split` records given up front and the rest append()ed), rows with canonical names
#   {"mode": "build", "team", "exprs": ["T['turns'].eq('fed', True)...", ...]} -> [ast, ...]
#   {"mode": "remote", "pages": {json(ast): page}, "exprs": [...]} -> rows of each expression run through
#       connect(post=...), with the posts it made
#   {"mode": "immutable"} -> {check: bool}
#   {"mode": "bench", "records", "team", "queries": {name: expr}, "repeat"} -> {name: microseconds per run}
import importlib.util
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("history", os.path.join(HERE, "..", "..", "vendor", "query", "history.py"))
H = importlib.util.module_from_spec(spec)
sys.modules["history"] = H
spec.loader.exec_module(H)


def canonical(entity, row):
    if isinstance(row, H.Row):
        names = H._NAMES[entity]
        return {names.get(k, k): v for k, v in row.items()}
    return row.to_json()


def run(job):
    entity, team = job["entity"], job.get("team")
    if entity == H.PROGRAM_ENTITY:
        split = job.get("split", len(job["records"]))
        loc = H.local(job["records"][:split], team)
        loc.append(job["records"][split:])
        table_run = loc.run
    else:
        table = H.Table(entity, job["records"])
        table_run = lambda ast: table.run(ast, team)
    out = []
    for ast in job["queries"]:
        try:
            out.append({"rows": [canonical(ast["from"], r) for r in table_run(ast)]})
        except H.QueryError as e:
            out.append({"error": str(e)})
    return out


def build(job):
    T = {e: H.Table(e).query(job.get("team")) for e in H.SCHEMA["entities"]}
    return [eval(x, {"T": T, "H": H}) .ast() for x in job["exprs"]]


def remote(job):
    posts = []

    def post(path, ast):
        posts.append([path, ast])
        return job["pages"][json.dumps(ast, sort_keys=True, separators=(",", ":"))]

    h = H.connect("http://unused", room="R", game="G", post=post)
    out = []
    for x in job["exprs"]:
        q = eval(x, {"h": h})
        out.append([canonical(q.ast()["from"], r) for r in q.rows()])
    return {"rows": out, "posts": posts}


def immutable(job):
    checks = {}
    t = H.Table("turns", [{"game": "g", "round": 1, "bee": 0, "flower": 1, "challenge": 1, "fed": True, "pollen": 1.0}])
    q = t.query(0)
    q2 = q.eq("fed", True)
    checks["builder returns a new query"] = q is not q2 and q.ast() == {"from": "turns"} and q2.ast()["where"][0]["field"] == "fed"
    try:
        q.limit = 3
        checks["queries can't be changed"] = False
    except AttributeError:
        checks["queries can't be changed"] = True
    a = q2.ast()
    a["where"].append("junk")
    checks["ast() is a copy"] = q2.ast()["where"] == [{"field": "fed", "op": "eq", "value": True}]
    rows = q.rows()
    checks["results are tuples"] = isinstance(rows, tuple)
    try:
        rows[0].round = 5
        checks["records can't be changed"] = False
    except AttributeError:
        checks["records can't be changed"] = True
    row = q.count().rows()[0]
    try:
        row.count = 5
        checks["rows can't be changed"] = False
    except AttributeError:
        checks["rows can't be changed"] = True
    loc = H.local([], 0)
    try:
        loc.history.turns = None
        checks["HISTORY can't be changed"] = False
    except AttributeError:
        checks["HISTORY can't be changed"] = True
    checks["HISTORY has no append"] = not hasattr(loc.history, "append")
    return checks


def bench(job):
    loc = H.local(job["records"], job.get("team"))
    h = loc.history
    out = {}
    for name, expr in job["queries"].items():
        q = eval(expr, {"h": h, "R": job["rounds"]})
        q.rows()  # warm up
        n = job.get("repeat", 200)
        t0 = time.perf_counter()
        for _ in range(n):
            q.rows()
        out[name] = (time.perf_counter() - t0) / n * 1e6
    return out


if __name__ == "__main__":
    job = json.loads(sys.stdin.read())
    result = {"run": run, "build": build, "remote": remote, "immutable": immutable, "bench": bench}[job["mode"]](job)
    sys.stdout.write(json.dumps(result))
