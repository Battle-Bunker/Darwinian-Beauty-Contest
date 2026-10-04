# Querying history

Operators and LLM team agents query a game's history the same way: with a small, typed, immutable
**query builder** that builds a language-neutral **query AST** (JSON), run by one of three executors.
(Game programs get no history: only their arguments, `GAME` and the bee's `MEMORY`; RULES.md.)

| Executor | Where | Data | Visibility |
|---|---|---|---|
| **in-memory** | in any client, over rows it holds (`local()`) | the team ledger | already masked: it holds exactly what the team may see |
| **SQL** | the server: `POST …/query` | Postgres | enforced in SQL, per viewer, with the same rules |
| **remote** | the generated clients (Python stdlib `urllib`, TypeScript `fetch`) | the server, over HTTP | the server's |

There is no ORM. One schema, [`server/query/schema.js`](../server/query/schema.js), is the single source
of truth: entities, fields, types, indexes, scopes and each field's visibility rule. Code generators in
[`scripts/gen-query/`](../scripts/gen-query/) turn it into a client library per language, checked in under
[`vendor/query/`](../vendor/query/) (and served by the game server at `/vendor/query/…`):

| File | What |
|---|---|
| `vendor/query/history.py` | Python: named-tuple records (immutable), the typed builder, the in-memory and remote executors (stdlib only) |
| `vendor/query/history.ts` | TypeScript: readonly record interfaces, the typed builder, the in-memory and remote executors |
| `vendor/query/history.js` | the same TypeScript with its types stripped, as a plain script (`DbcHistory`): what the server and its tests load |
| `vendor/query/schema.json` | the schema as JSON, for anything else |

`npm run gen:query` regenerates them; `npm test` fails if they are stale. The generator lives in
`scripts/gen-query/`: `index.js` (the driver), `common.js`, one emitter per language (`typescript.js`,
`python.js`) and its fixed runtime (`templates/runtime.ts`, `templates/runtime.py`).

## Entities

| Entity | One row per | Key (natural order) | In `local()` |
|---|---|---|---|
| `turns` | finished turn | game, round, bee | `h.turns` |
| `versions` | program version | game, team, kind, version | |
| `teams` | team playing (with its bee's MEMORY: value, size, version, last error) | game, index | |
| `pairs` | (bee team, flower team): the score ledgers | game, bee, flower | |
| `scores` | team: the scoreboard | game, team | |

Fields, types and visibility are in the schema (and in `vendor/query/schema.json`). Teams are numbered by
**index** (0 to N − 1, `GAME.team` in programs), as in the team ledger. `game` is the game's short id.

**Big responses.** A turn whose response is over 4 KB of JSON has `response: null`, with its size in
`responseBytes` and the SHA-256 of its JSON text in `responseHash` (filter on that for equality); its whole
text is at `GET /api/rooms/:room/games/:game/responses/:seq`, `seq` being the turn's `seq`.

**Visibility.** During play a field you may not see reads as `null`, everywhere: in rows, in filters, in
sorts and in aggregates (`sum(percent)` over turns without a feed adds up only your own flower's). The
rules: `turns.percent` and `turns.energy` are public on a feed, else the flower's team's; `turns.ms`,
`flowerVersion` and `flowerError` are the flower's team's; `beeMs`, `beeVersion` and `beeError` the bee's
team's; `teams.memory`, `memoryBytes`, `memoryVersion` and `memoryError` (the bee's MEMORY) the team's own;
`versions` rows are your own team's only; everything else is public. Once a game is over,
everything is visible (`versions.code` only if the game is revealed).

## The query AST

```jsonc
{
  "from": "turns",                                   // an entity
  "scope": "myBee",                                  // optional: myBee | myFlower | mine (bee or flower), resolved
                                                     //   against the querying team (versions, teams, scores: mine)
  "where": [                                         // optional, all must hold
    { "field": "round", "op": "between", "value": [10, 20] },
    { "field": "fed", "op": "eq", "value": true },
    { "field": "flower", "op": "in", "value": [1, 2] },
    { "field": "percent", "op": "isNull", "value": false }
  ],
  "groupBy": ["flower"],                             // optional
  "aggregates": [                                    // optional: count (rows, or a field's non-nulls), sum, avg, min, max
    { "fn": "count", "as": "count" },
    { "fn": "sum", "field": "nectar", "as": "sum_nectar" }
  ],
  "select": ["round", "bee", "nectar"],              // optional, without aggregates: only these fields
  "orderBy": [{ "field": "sum_nectar", "dir": "desc" }],  // optional: fields, or aggregate names
  "limit": 10, "offset": 0                           // optional
}
```

Semantics (every executor follows them exactly; the parity tests check it):
- **Ops**: `eq`, `ne`, `lt`, `le`, `gt`, `ge` take a non-null value; `in` a list of non-null values;
  `between` `[lo, hi]`, inclusive; `isNull` `true` or `false`. A null field matches only `isNull: true`
  (as in SQL: `ne` doesn't match null). Which ops a field takes depends on its type: numbers take all;
  `bool`, `str` and `json` take `eq`, `ne`, `in` and `isNull`. `json` values (challenges and responses)
  compare as JSON: `1` equals `1.0`, objects regardless of key order, `true` is not `1`.
- **Aggregates**: `count` without a field counts rows; with a field, its non-null values. `sum`, `avg`,
  `min` and `max` take numeric fields and ignore nulls; over no values they are `null` (`count` is 0).
  Without `groupBy`, an aggregate query returns exactly one row, even over no rows. With `groupBy`, one
  row per group (nulls form a group), holding the group fields and the aggregates. `json` fields can't be
  grouped, sorted or aggregated (except `count`).
- **Order**: rows come in the entity's natural order (its key) unless `orderBy` says otherwise; grouped
  rows by the group fields. Ties are broken by the natural order (grouped: by the group fields). Nulls
  sort last, ascending or descending. Strings sort by code point.
- `limit` / `offset` apply last. Without aggregates, `select` keeps only the fields named.
- Numbers: `count` is an integer; `sum` and `avg` are floats (compare them with a tolerance across
  executors); `min` and `max` keep the field's type.

## The builder

Every method returns a **new**, frozen query; nothing is ever modified in place, so a query can be kept,
shared and extended freely. Results are immutable too.

**Python** (`history.py`; field names in snake_case: `at_ms`, `bee_ms`, `flower_version`, …):

```python
h = history.local(turn_records, team=2)          # or connect(...), below
q = h.turns.my_bee().eq("fed", True).group_by("flower").sum("nectar").count()
q.rows()        # (Row(flower=0, sum_nectar=..., count=...), ...)
q.ast()         # the JSON AST above, as a dict

h.turns.rounds(10, 20).eq("flower", 2).order_by("round", desc=True).limit(5).rows()   # (Turn, ...)
h.turns.count().value()                          # an int
h.turns.offset(done).rows()                      # the turns after the first `done`
```

Conditions: `eq ne lt le gt ge` (field, value), `in_` (field, values), `between` (field, lo, hi),
`is_null` / `not_null` (field), `rounds(lo, hi)`. Scopes: `my_bee() my_flower() mine()`. Shape:
`select(*fields) group_by(*fields) count(field=None, as_=None) sum avg min max (field, as_=None)
order_by(field, desc=False) limit(n) offset(n)`. Run: `rows() first() value() ast()`.

**TypeScript** (`history.ts`; canonical camelCase names):

```ts
const q = h.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar").count();
q.rows();       // readonly { flower: number; sum_nectar: number | null; count: number }[]
h.turns.rounds(10, 20).eq("flower", 2).orderBy("round", "desc").limit(5).rows();   // readonly Turn[]
```

Conditions: `eq ne lt le gt ge in between isNull notNull rounds`; scopes `myBee myFlower mine`; shape
`select groupBy count sum avg min max orderBy limit offset`; run `rows first value ast`. Field names,
values and result rows are typed from the schema.

Aggregate names default to `count` for rows and `<fn>_<field>` otherwise (in the language's own field
naming); pass `as_` / a second argument to choose one.

## In memory: indexes and cost

`local()` (below) keeps the turns as the team may see them, with indexes kept up to date as records are
appended:
- records in natural order, so `rounds(lo, hi)`, `offset` and `limit` are binary searches and slices;
- per-value indexes on `bee`, `flower`, `fed` and (`bee`, `flower`);
- running statistics per (`bee`, `flower`, `fed`) cell: count, and sum, non-null count, min and max of
  every numeric field, so aggregates filtered and grouped by those fields cost O(cells), not O(turns).

Python sees records as named tuples with snake_case fields (`t.round`, `t.bee_ms`); TypeScript as frozen
objects (`t.round`, `t.beeMs`). Records and results are read-only; nested JSON values (a list-shaped
challenge, say) are shared, so don't change them.

Measured on a 20,000-turn history (8 teams × 2,500 rounds; `npm test` prints the table):

| Query | TypeScript | Python |
|---|---|---|
| `count()` | 75 µs | 167 µs |
| my bee's nectar per flower: `my_bee().eq(fed).group_by(flower).sum(nectar).count()` (cells) | 46 µs | 109 µs |
| average percent per flower on feeds (cells) | 56 µs | 146 µs |
| one pair's feeds (cells) | 13 µs | 35 µs |
| my flower, last 50 rounds (index + range) | 13 µs | 27 µs |
| my bee's last 10 turns, newest first (index) | 6 µs | 14 µs |
| the turns since the last call: `offset(n)` (slice) | 3 µs | 7 µs |
| one flower's answers to one challenge, last 100 rounds (index + range + filter) | 18 µs | 71 µs |
| every turn with a given challenge (a full scan: json fields have no index) | 506 µs | 6.6 ms |

## Over HTTP

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/rooms/:room/games/:game/query` | an AST | `{ rows, truncated }`: one game, as the viewer may see it (a session cookie or `Authorization: Bearer` token; spectators get the public fields) |
| POST | `/api/rooms/:room/query` | an AST | `{ rows, truncated }`: across every **finished** game in the room (fully revealed; `game` tells them apart; `mine` and the scopes mean the viewer's team in each game) |
| GET | `/api/query/schema` | | the schema |

The server compiles the AST to parameterised SQL. Visibility is enforced in SQL: each entity is read
through a subquery that masks what the viewer may not see before any filter, sort or aggregate runs.
`limit` defaults to 1,000 and is capped at 5,000 (`truncated: true` when more rows matched); a query may
take at most 2 s.

The generated clients run the same builder remotely:

```python
from history import connect                 # vendor/query/history.py, stdlib only
h = connect("http://localhost:3000", room="ABC", game="7", token=TOKEN)
h.turns.my_bee().eq("fed", True).group_by("flower").sum("nectar").rows()
h.scores.order_by("fitness", desc=True).rows()
```

```ts
import { connect } from "./history.ts";
const h = connect({ base: "http://localhost:3000", room: "ABC", game: "7", token });
await h.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar").rows();   // remote results are Promises
```

Leave out `game` to query across the room's finished games. Both clients take a **`post`** transport
instead of their built-in HTTP: `connect(room=..., game=..., post=post)` (Python: `post(path, ast) ->
{"rows", "truncated"}`; TypeScript: `post(path, ast) => Promise<{ rows, truncated }>`), so a caller can route
queries through its own runner (adding a token, say) and still use the builder; `rows()` and `value()` work
unchanged.

## A history you hold: `local()`

`local(records, team)` (both languages) builds an in-memory history over turn records you hold:
canonical camelCase dicts or objects, exactly as `GET …/ledger` and `…/query` return them (fields the
schema doesn't have are ignored).

| | Python | TypeScript |
|---|---|---|
| a read-only root, to hand to code that should only read | `h.history` | `h.history` |
| its turns query (the same as `h.history.turns`) | `h.turns` | `h.turns` |
| add new turns; the indexes are updated incrementally | `h.append(records)` | `h.append(records)` |
| run a raw query AST | `h.run(ast)` | `h.run(ast)` |

```python
h = history.local(turn_records, team=2)
h.turns.my_bee().eq("fed", True).group_by("flower").sum("nectar").rows()
h.append(new_turn_records)
```

`h.history` has no `append`. (Underneath, `Table(entity, records)` is the in-memory executor for any
entity: `Table("scores", rows).query(team)`.)

## How the in-memory executor runs a query

The algorithm every language implements (so their results and their costs agree):

1. **Scope.** `myBee` → `bee = team`; `myFlower` → `flower = team`; `mine` → `bee = team or flower = team`
   (for entities whose scope names one field, that field = team).
2. **Cells** (aggregates only). If every condition, every group field and the scope only involve the
   entity's `cells` fields, and every aggregate is `count` or over a numeric field, answer from the cell
   statistics: keep the cells whose key satisfies the conditions, merge them per group. O(cells).
3. **Candidates.** Otherwise start from the smallest index bucket matched by an `eq` condition on an
   indexed field (or field pair), else all records. Both are in natural order. If there are conditions on
   `sortedBy`, narrow the candidates to that range by binary search.
4. **Filter** the candidates by every condition.
5. **Shape.** Group and aggregate; or sort (only if the order isn't the natural one), offset, limit,
   select. With the natural order and no remaining conditions, offset and limit are a slice.

## Adding a language

A language gets a client by adding one emitter: `scripts/gen-query/<language>.js`, exporting
`emit(schema) → { "<file name>": "<contents>", ... }`, and listing it in `scripts/gen-query/index.js`. The
emitter writes, from the schema:

1. **Record types**, one per entity, immutable, with the language's field naming and the schema's types
   (`int`, `float`, `bool`, `str`, `json` → any; nullable fields optional/nullable).
2. **The schema tables the runtime needs**: per entity its fields (canonical name, language name, type),
   key, `sortedBy`, `index`, `cells` and scopes.
3. **The builder**: an immutable query object whose methods each return a new query and build the AST
   above (canonical names in the AST, language names in the API).
4. **The in-memory executor** (`Table`): `append(records)` keeps the records in natural order and updates
   the indexes and cell statistics; `run(ast, team)` follows the algorithm above.
5. **The remote executor**: POST the AST to `/api/rooms/:room[/games/:game]/query`, convert the rows'
   field names back, and return them through the same builder API.

The Python and TypeScript emitters are the reference: most of each is a fixed runtime with the schema
tables filled in. Add the new language to the parity test (`test/query.test.js`), which runs the same
ASTs through every executor and compares the results, and to the staleness check.
