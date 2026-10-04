# Querying history

Operators, LLM team agents and in-game programs all query a game's history the same way: with a small,
typed, immutable **query builder** that builds a language-neutral **query AST** (JSON), run by one of
three executors:

| Executor | Where | Data | Visibility |
|---|---|---|---|
| **in-memory** | inside programs, as the global `HISTORY`; or in any client over rows it holds | the team ledger | already masked: it holds exactly what the team may see |
| **SQL** | the server: `POST …/query` | Postgres | enforced in SQL, per viewer, with the same rules |
| **remote** | the generated clients (Python stdlib `urllib`, TypeScript `fetch`) | the server, over HTTP | the server's |

There is no ORM. One schema, [`server/query/schema.js`](../server/query/schema.js), is the single source
of truth: entities, fields, types, indexes, scopes and each field's visibility rule. Code generators in
[`scripts/gen-query/`](../scripts/gen-query/) turn it into a client library per language, checked in under
[`vendor/query/`](../vendor/query/) (and served by the game server at `/vendor/query/…`):

| File | What |
|---|---|
| `vendor/query/history.py` | Python: frozen dataclass records, the typed builder, the in-memory and remote executors (stdlib only) |
| `vendor/query/history.ts` | TypeScript: readonly record interfaces, the typed builder, the in-memory and remote executors |
| `vendor/query/history.js` | the same TypeScript with its types stripped, as a plain script (`DbcHistory`): what the TypeScript runner and the server load |
| `vendor/query/schema.json` | the schema as JSON, for anything else |

`npm run gen:query` regenerates them; `npm test` fails if they are stale.

## Entities

| Entity | One row per | Key (natural order) | In programs |
|---|---|---|---|
| `turns` | finished turn | game, round, bee | `HISTORY.turns` |
| `versions` | program version | game, team, kind, version | |
| `teams` | team playing | game, index | |
| `pairs` | (bee team, flower team): the score ledgers | game, bee, flower | |
| `scores` | team: the scoreboard | game, team | |

Fields, types and visibility are in the schema (and in `vendor/query/schema.json`). Teams are numbered by
**index** (0 to N − 1, `GAME.team` in programs), as in the team ledger. `game` is the game's short id.

**Visibility.** During play a field you may not see reads as `null`, everywhere: in rows, in filters, in
sorts and in aggregates (`sum(percent)` over turns without a feed adds up only your own flower's). The
rules: `turns.percent` and `turns.energy` are public on a feed, else the flower's team's; `turns.ms`,
`flowerVersion` and `flowerError` are the flower's team's; `beeMs`, `beeVersion` and `beeError` the bee's
team's; `versions` rows are your own team's only; everything else is public. Once a game is over,
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
q = HISTORY.turns.my_bee().eq("fed", True).group_by("flower").sum("nectar").count()
q.rows()        # (Row(flower=0, sum_nectar=..., count=...), ...)
q.ast()         # the JSON AST above, as a dict

HISTORY.turns.rounds(10, 20).eq("flower", 2).order_by("round", desc=True).limit(5).rows()   # (Turn, ...)
HISTORY.turns.count().value()                    # an int
HISTORY.turns.offset(done).rows()                # the turns after the first `done`
```

Conditions: `eq ne lt le gt ge` (field, value), `in_` (field, values), `between` (field, lo, hi),
`is_null` / `not_null` (field), `rounds(lo, hi)`. Scopes: `my_bee() my_flower() mine()`. Shape:
`select(*fields) group_by(*fields) count(field=None, as_=None) sum avg min max (field, as_=None)
order_by(field, desc=False) limit(n) offset(n)`. Run: `rows() first() value() ast()`.

**TypeScript** (`history.ts`; canonical camelCase names):

```ts
const q = HISTORY.turns.myBee().eq("fed", true).groupBy("flower").sum("nectar").count();
q.rows();       // readonly { flower: number; sum_nectar: number | null; count: number }[]
HISTORY.turns.rounds(10, 20).eq("flower", 2).orderBy("round", "desc").limit(5).rows();   // readonly Turn[]
```

Conditions: `eq ne lt le gt ge in between isNull notNull rounds`; scopes `myBee myFlower mine`; shape
`select groupBy count sum avg min max orderBy limit offset`; run `rows first value ast`. Field names,
values and result rows are typed from the schema.

Aggregate names default to `count` for rows and `<fn>_<field>` otherwise (in the language's own field
naming); pass `as_` / a second argument to choose one.

## In programs: `HISTORY`

Programs get `HISTORY` as an immutable global next to `GAME`: `HISTORY.turns` is the team ledger, every
finished turn of every bee, masked for the team. It is built between turns, outside the timed calls,
with indexes kept up to date incrementally:
- records in natural order, so `rounds(lo, hi)`, `offset` and `limit` are binary searches and slices;
- per-value indexes on `bee`, `flower`, `fed` and (`bee`, `flower`);
- running statistics per (`bee`, `flower`, `fed`) cell: count, and sum, non-null count, min and max of
  every numeric field, so aggregates filtered and grouped by those fields cost O(cells), not O(turns).

Running a query is the program's own compute (a flower pays for it in energy), so the executor picks the
cheapest plan it can (below).

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

Leave out `game` to query across the room's finished games.

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
ASTs through every executor and compares the results, and to the staleness check. To make it a **program
language** too, add a runner (`server/runners/`) that loads the generated module and exposes `HISTORY`.
