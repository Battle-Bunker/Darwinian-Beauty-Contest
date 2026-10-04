// What Python programs can use (server/runners/py_rules.py, RULES.md "What programs can use"): ordinary
// programs pass the rules; a dunder attribute or a removed builtin is reported with the line and the
// construct, at check time and by the runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgramProcess } from "../server/runners/proc.js";
import { ruleBreaches } from "../server/lib/pyRules.js";
import { starters } from "./fixtures/programs.js";
import { normalizeConfig } from "../server/lib/gameConfig.js";

const ORDINARY = `import collections, dataclasses, enum, functools, heapq, json, math, operator, random, statistics, time

@dataclasses.dataclass(order=True)
class Point:
    x: int
    y: int = 0

    def __post_init__(self):
        self.y = self.y or self.x

class K