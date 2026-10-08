"""Your pollen grains: on every feed of your bee, your team gets a grain of the flower that answered, a run of
floor(scale * pollen ** exponent) characters (config.json: pollenGrain) of that flower version's minified code (the
text the game runs), from a random start, wrapping from the end back to the start, with the version and the code's
length (not where the grain starts). During play only your team sees your grains; programs never get them. This tool lists them per species and version and pieces
them together where they overlap (best effort: short or repetitive pieces can be placed wrongly).

    python3 tools/grains.py                       # per species and version: grains, characters, code length, how much
                                                  # is pieced together
    python3 tools/grains.py --flower 2            # one species (team index), every version
    python3 tools/grains.py --flower 2 --version 3 --show
                                                  # ...and the pieced-together code (the pieces, or the whole program)
    python3 tools/grains.py --save                # write each version pieced together completely to
                                                  # grains/<species>-v<version>.<ext> in your workspace
    python3 tools/grains.py --json                # the raw grains and the assembly, as JSON

From a script:  import sys; sys.path.insert(0, "tools"); import garden
                garden.grains(flower=2)                          # your grains, oldest first (dicts)
                garden.assemble(flower=2, version=3)             # {"pieces", "covered", "code", ...}
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stream import Stream  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_OVERLAP = 6  # pieces join only on at least this many characters in common


def grains(flower=None, version=None, stream=None):
    """Your grains from stream/history.jsonl, oldest first: [{"seq", "round", "at_ms", "flower", "version",
    "code_length", "grain"}] (flower: a team index; version: that species' flower version)."""
    s = stream or Stream(ROOT)
    out = []
    for e in s.records():
        g = e.get("grain")
        if not g:
            continue
        if flower is not None and e.get("flower") != flower:
            continue
        if version is not None and e.get("grainVersion") != version:
            continue
        out.append({"seq": e.get("seq"), "round": e.get("round"), "at_ms": e.get("atMs"), "flower": e.get("flower"),
                    "version": e.get("grainVersion"), "code_length": e.get("grainCodeLength"), "grain": g})
    return out


def _periodic(contig, length):
    """A piece at least as long as the code is the code, wrapped: every character equals the one `length` later."""
    return len(contig) >= length and all(contig[i] == contig[i + length] for i in range(len(contig) - length))


def _rotate(cyclic, language="python"):
    """The code from a cyclic text (where it starts is unknown, and the code's end runs straight into its start): for
    Python, the rotation that compiles, trying likely starts first (import, from, def, class), then every other word
    start; else a rotation that starts like a program; else the text as it is. (code, compiles)"""
    n = len(cyclic)
    word = lambda ch: ch.isalnum() or ch == "_"
    # (The character before the true start is the code's last one, which may well be a letter or a digit: "...,40def f".)
    starts = [i for i in range(n) if word(cyclic[i]) or cyclic[i] in "@([{\"'"]
    first = ("import ", "from ", "def ", "class ", "function ", "const ", "let ", "var ")
    starts.sort(key=lambda i: (not any(cyclic.startswith(w, i) for w in first), i))
    if language == "python":
        for i in starts:
            text = cyclic[i:] + cyclic[:i]
            try:
                compile(text, "<grains>", "exec")
                return text, True
            except (SyntaxError, ValueError):
                continue
    for i in starts:
        if any(cyclic.startswith(w, i) for w in first):
            return cyclic[i:] + cyclic[:i], False
    return cyclic, False


def assemble(pieces, length, language="python"):
    """Piece grains of one code of `length` characters together (best effort): drop pieces inside others, then join the
    pairs with the longest overlaps first (at least MIN_OVERLAP characters). {"pieces": [text, ...] (longest first),
    "covered": characters covered (at most length), "share", "complete", "code" (the whole code when complete, rotated
    to where it most likely starts), "compiles"}."""
    if not length:
        # (bare grains, as in a private game during play: no code length, so no assembly; the pieces as they are)
        return {"pieces": sorted(set(p for p in pieces if p), key=len, reverse=True), "covered": None, "share": None, "complete": False, "code": None, "compiles": False}
    # A grain as long as the code is the whole code (from a random start).
    uniq = sorted(set(p for p in pieces if p), key=len, reverse=True)
    for p in uniq:
        if len(p) >= length:
            cyc = p[:length]
            code, ok = _rotate(cyc, language)
            return {"pieces": [cyc], "covered": length, "share": 1.0, "complete": True, "code": code, "compiles": ok}
    kept = []
    for p in uniq:
        if not any(p in q for q in kept):
            kept.append(p)
    # Candidate overlaps: the suffix of a equal to the prefix of b, found through b's first MIN_OVERLAP characters.
    by_prefix = {}
    for j, b in enumerate(kept):
        by_prefix.setdefault(b[:MIN_OVERLAP], []).append(j)
    cands = []
    for i, a in enumerate(kept):
        for start in range(1, len(a) - MIN_OVERLAP + 1):
            for j in by_prefix.get(a[start:start + MIN_OVERLAP], ()):
                if j != i and kept[j].startswith(a[start:]):
                    cands.append((len(a) - start, i, j))
    cands.sort(reverse=True)
    nxt, prv, over = {}, {}, {}
    root = list(range(len(kept)))

    def find(x):
        while root[x] != x:
            root[x] = root[root[x]]
            x = root[x]
        return x
    for k, i, j in cands:
        if i in nxt or j in prv or find(i) == find(j):
            continue
        nxt[i], prv[j], over[i] = j, i, k
        root[find(j)] = find(i)
    contigs = []
    for i in range(len(kept)):
        if i in prv:
            continue
        text, x = kept[i], i
        while x in nxt:
            text += kept[nxt[x]][over[x]:]
            x = nxt[x]
        contigs.append(text)
    contigs.sort(key=len, reverse=True)
    # A piece longer than the code that repeats itself every `length` characters (it wrapped) is the whole code.
    for c in contigs:
        if _periodic(c, length):
            cyc = c[:length]
            code, ok = _rotate(cyc, language)
            return {"pieces": [cyc], "covered": length, "share": 1.0, "complete": True, "code": code, "compiles": ok}
    covered = min(length, sum(len(c) for c in contigs))
    return {"pieces": contigs, "covered": covered, "share": round(covered / length, 3), "complete": False, "code": None, "compiles": False}


def _language():
    try:
        with open(os.path.join(ROOT, "config.json")) as f:
            return json.load(f).get("language", "python")
    except (OSError, ValueError):
        return "python"


def summary(flower=None, version=None):
    """Per (species, version): the grains, their characters, the code length and the assembly."""
    by = {}
    for g in grains(flower, version):
        by.setdefault((g["flower"], g["version"]), []).append(g)
    lang = _language()
    out = []
    for (f, v), gs in sorted(by.items(), key=lambda kv: (kv[0][0] if kv[0][0] is not None else -1, kv[0][1] or 0)):
        length = gs[-1]["code_length"]
        a = assemble([g["grain"] for g in gs], length, lang)
        out.append({"flower": f, "version": v, "grains": len(gs), "characters": sum(len(g["grain"]) for g in gs), "code_length": length,
                    "first_ms": gs[0]["at_ms"], "last_ms": gs[-1]["at_ms"], **a})
    return out


if __name__ == "__main__":
    args = sys.argv[1:]

    def opt(name):
        return int(args[args.index(name) + 1]) if name in args and args.index(name) + 1 < len(args) else None
    s = Stream(ROOT)
    rows = summary(opt("--flower"), opt("--version"))
    if "--json" in args:
        print(json.dumps(rows, indent=1))
        sys.exit(0)
    if not rows:
        print("No grains yet: your team gets one on every feed of your bee (none when the pollen is 0, or when the game turns grains off).")
        sys.exit(0)
    print("species of            version  grains  characters  code length  pieced together")
    for r in rows:
        state = "complete" if r["complete"] else ("%d piece%s (no code length to piece them by)" % (len(r["pieces"]), "" if len(r["pieces"]) == 1 else "s") if r["share"] is None
                                                  else "%d%% in %d piece%s" % (round(100 * (r["share"] or 0)), len(r["pieces"]), "" if len(r["pieces"]) == 1 else "s"))
        nm = s.name(r["flower"]) if r["flower"] is not None else "(unknown: bare grains)"
        print("%s %-20s %7s %7d %11d %12s  %s" % ("*" if r["flower"] is not None and r["flower"] == s.my_index else " ", nm[:20], "v%s" % r["version"] if r["version"] is not None else "-", r["grains"],
                                               r["characters"], r["code_length"] or 0, state))
    print("(* = your own species; the pieces are best effort: short or repeated text can join wrongly)")
    if "--show" in args:
        for r in rows:
            print("\n=== %s v%s (%s)" % (s.name(r["flower"]) if r["flower"] is not None else "bare grains", r["version"], "complete" if r["complete"] else "%d piece(s)" % len(r["pieces"])))
            if r["complete"]:
                print(r["code"])
            else:
                for p in r["pieces"][:20]:
                    print("--- %d characters\n%s" % (len(p), p))
    if "--save" in args:
        ext = "ts" if _language() == "typescript" else "py"
        d = os.path.join(ROOT, "grains")
        for r in rows:
            if r["complete"]:
                os.makedirs(d, exist_ok=True)
                name = "".join(ch if ch.isalnum() else "_" for ch in s.name(r["flower"]))
                path = os.path.join(d, "%s-v%s.%s" % (name, r["version"], ext))
                with open(path, "w") as f:
                    f.write(r["code"])
                print("saved %s" % os.path.relpath(path, ROOT))
