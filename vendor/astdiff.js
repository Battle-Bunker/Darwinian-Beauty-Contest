"use strict";
var AstDiffTS = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser-entry.ts
  var browser_entry_exports = {};
  __export(browser_entry_exports, {
    SAMPLES: () => SAMPLES,
    createTreeSitterDiff: () => createTreeSitterDiff
  });

  // src/astdiff.ts
  function postorder(root) {
    const nodes = [null];
    const lld = [0];
    const stack = [{ node: root, i: 0, first: -1 }];
    let returned = -1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (returned >= 0) {
        if (top.first < 0) top.first = returned;
        returned = -1;
      }
      if (top.i < top.node.children.length) {
        stack.push({ node: top.node.children[top.i++], i: 0, first: -1 });
        continue;
      }
      stack.pop();
      nodes.push(top.node);
      const idx = nodes.length - 1;
      lld.push(top.first < 0 ? idx : top.first);
      returned = lld[idx];
    }
    const n = nodes.length - 1;
    const seen = /* @__PURE__ */ new Set();
    const keyroots = [];
    for (let i = n; i >= 1; i--) if (!seen.has(lld[i])) {
      seen.add(lld[i]);
      keyroots.push(i);
    }
    keyroots.sort((a, b) => a - b);
    return { nodes, lld, keyroots, n };
  }
  function ted(rootA, rootB) {
    const A = postorder(rootA), B = postorder(rootB);
    const n = A.n, m = B.n;
    const la = A.nodes.map((x) => x && x.label), lb = B.nodes.map((x) => x && x.label);
    const W = m + 1, FW = m + 2;
    const TD = new Int32Array((n + 1) * W);
    const FD = new Int32Array((n + 2) * FW);
    function forest(i, j, store) {
      const l1 = A.lld[i], l2 = B.lld[j], r0 = l1 - 1, c0 = l2 - 1;
      FD[0] = 0;
      for (let x = l1; x <= i; x++) FD[(x - r0) * FW] = FD[(x - 1 - r0) * FW] + 1;
      for (let y = l2; y <= j; y++) FD[y - c0] = FD[y - 1 - c0] + 1;
      for (let x = l1; x <= i; x++) {
        const lx = A.lld[x], rx = (x - r0) * FW, rp = (x - 1 - r0) * FW;
        for (let y = l2; y <= j; y++) {
          const ly = B.lld[y], cy = y - c0;
          const del = FD[rp + cy] + 1, ins = FD[rx + cy - 1] + 1;
          let v;
          if (lx === l1 && ly === l2) {
            v = Math.min(del, ins, FD[rp + cy - 1] + (la[x] === lb[y] ? 0 : 1));
            if (store) TD[x * W + y] = v;
          } else {
            v = Math.min(del, ins, FD[(lx - 1 - r0) * FW + (ly - 1 - c0)] + TD[x * W + y]);
          }
          FD[rx + cy] = v;
        }
      }
    }
    for (const i of A.keyroots) for (const j of B.keyroots) forest(i, j, true);
    const distance = TD[n * W + m];
    const mapping = [];
    const pairs = [[n, m]];
    while (pairs.length) {
      const [i, j] = pairs.pop();
      forest(i, j, false);
      const l1 = A.lld[i], l2 = B.lld[j], r0 = l1 - 1, c0 = l2 - 1;
      let x = i, y = j;
      while (x >= l1 || y >= l2) {
        const cur = FD[(x - r0) * FW + (y - c0)];
        if (x >= l1 && cur === FD[(x - 1 - r0) * FW + (y - c0)] + 1) {
          mapping.push([A.nodes[x], null]);
          x--;
        } else if (y >= l2 && cur === FD[(x - r0) * FW + (y - 1 - c0)] + 1) {
          mapping.push([null, B.nodes[y]]);
          y--;
        } else if (A.lld[x] === l1 && B.lld[y] === l2) {
          mapping.push([A.nodes[x], B.nodes[y]]);
          x--;
          y--;
        } else {
          pairs.push([x, y]);
          x = A.lld[x] - 1;
          y = B.lld[y] - 1;
        }
      }
    }
    return { distance, mapping };
  }
  function diffParsed(a, b) {
    const { distance, mapping } = ted(a.root, b.root);
    const ops = [];
    for (const [x, y] of mapping) {
      if (!x) ops.push({ kind: "insert", new: y });
      else if (!y) ops.push({ kind: "delete", old: x });
      else if (x.label !== y.label) ops.push({ kind: "relabel", old: x, new: y });
    }
    const order = { delete: 0, relabel: 1, insert: 2 };
    const lineOf = (o) => "old" in o ? o.old.line : o.new.line;
    ops.sort((p, q) => lineOf(p) - lineOf(q) || order[p.kind] - order[q.kind]);
    return { old: a, new: b, distance, ops };
  }
  function highlights(d) {
    const L = [], R = [];
    for (const op of d.ops) {
      if (op.kind === "delete") for (const [s, e] of op.old.own) L.push([s, e, "del"]);
      else if (op.kind === "insert") for (const [s, e] of op.new.own) R.push([s, e, "ins"]);
      else {
        for (const [s, e] of op.old.own) L.push([s, e, "rel"]);
        for (const [s, e] of op.new.own) R.push([s, e, "rel"]);
      }
    }
    return { old: L, new: R };
  }

  // src/astdiff-treesitter.ts
  var DEFAULT_PUNCTUATION = ["(", ")", "[", "]", "{", "}", ",", ";", ":"];
  var flag = (v) => typeof v === "function" ? v() : !!v;
  function createTreeSitterDiff(parser, opts = {}) {
    var _a, _b, _c;
    const punct = new Set((_a = opts.punctuation) != null ? _a : DEFAULT_PUNCTUATION);
    const isComment = (_b = opts.isComment) != null ? _b : (n) => flag(n.isExtra) || n.type.includes("comment");
    const isTransparent = (_c = opts.isTransparent) != null ? _c : (n) => n.type.startsWith("parenthesized");
    function parse(source) {
      var _a2;
      const tree = parser.parse(source);
      const comments = [];
      function build(n) {
        while (isTransparent(n)) {
          const inner = n.namedChildren.filter((c) => !isComment(c));
          if (inner.length !== 1) break;
          for (const c of n.children) if (isComment(c)) comments.push([c.startIndex, c.endIndex]);
          n = inner[0];
        }
        const node = {
          kind: n.type,
          label: "",
          start: n.startIndex,
          end: n.endIndex,
          line: n.startPosition.row + 1,
          own: [],
          children: []
        };
        if (n.childCount === 0) {
          node.own.push([n.startIndex, n.endIndex]);
          node.label = flag(n.isMissing) ? "MISSING:" + n.type : n.type + "=" + source.slice(n.startIndex, n.endIndex);
          return node;
        }
        const tokens = [];
        const stack = n.children.slice().reverse();
        while (stack.length) {
          const c = stack.pop();
          if (isComment(c)) comments.push([c.startIndex, c.endIndex]);
          else if (flag(c.isNamed)) node.children.push(build(c));
          else if (c.childCount) stack.push(...c.children.slice().reverse());
          else if (c.type.trim() === "") continue;
          else {
            if (c.endIndex > c.startIndex) node.own.push([c.startIndex, c.endIndex]);
            if (!punct.has(c.type)) tokens.push(c.type);
          }
        }
        node.label = n.type + (tokens.length ? "[" + tokens.join(" ") + "]" : "");
        return node;
      }
      const rootNode = tree.rootNode;
      const root = build(rootNode);
      const hasError = flag(rootNode.hasError);
      (_a2 = tree.delete) == null ? void 0 : _a2.call(tree);
      comments.sort((a, b) => a[0] - b[0]);
      return { source, root, comments, hasError, size: sizeOf(root) };
    }
    function sizeOf(n) {
      let s = 1;
      for (const c of n.children) s += sizeOf(c);
      return s;
    }
    return {
      parse,
      nodeCount: (source) => parse(source).size,
      diff: (before, after) => diffParsed(parse(before), parse(after)),
      highlights,
      ted
    };
  }

  // src/samples.ts
  var SAMPLES = {
    python: {
      label: "Python",
      grammar: "python",
      before: `def score(cells, bonus):
    total = 0
    for c in cells:
        if c > 0:
            total += c * 2
    return total + bonus
`,
      after: `def score(cells, bonus):
    # weight raised to 3, cells capped below 9
    total = 0
    for c in cells:
        if c > 0 and c < 9:
            total += c * 3
    return bonus - total
`,
      reformatted: `def score( cells , bonus ):  # sum positive cells
    total=0
    for c in cells:
        if c>0: total += c*2
    return (total
            + bonus)
`
    },
    javascript: {
      label: "JavaScript",
      grammar: "javascript",
      before: `function score(cells, bonus) {
  let total = 0;
  for (const c of cells) {
    if (c > 0) total += c * 2;
  }
  return total + bonus;
}
`,
      after: `function score(cells, bonus) {
  // weight raised to 3, cells capped below 9
  let total = 0;
  for (const c of cells) {
    if (c > 0 && c < 9) total += c * 3;
  }
  return bonus - total;
}
`,
      reformatted: `function score(cells,bonus){ /* sum positive cells */
  let total=0
  for (const c of cells) { if (c>0) total+=c*2 }
  return (total + bonus)
}`
    },
    typescript: {
      label: "TypeScript",
      grammar: "typescript",
      before: `function score(cells: number[], bonus: number): number {
  let total = 0;
  for (const c of cells) {
    if (c > 0) total += c * 2;
  }
  return total + bonus;
}
`,
      after: `function score(cells: number[], bonus: number): number {
  // weight raised to 3, cells capped below 9
  let total = 0;
  for (const c of cells) {
    if (c > 0 && c < 9) total += c * 3;
  }
  return bonus - total;
}
`,
      reformatted: `/** Sum positive cells. */
function score(cells:number[],bonus:number):number{
  let total=0
  for (const c of cells) { if (c>0) total+=c*2 }
  return (total + bonus)
}`
    },
    rust: {
      label: "Rust",
      grammar: "rust",
      before: `fn score(cells: &[i32], bonus: i32) -> i32 {
    let mut total = 0;
    for c in cells {
        if *c > 0 {
            total += c * 2;
        }
    }
    total + bonus
}
`,
      after: `fn score(cells: &[i32], bonus: i32) -> i32 {
    // weight raised to 3, cells capped below 9
    let mut total = 0;
    for c in cells {
        if *c > 0 && *c < 9 {
            total += c * 3;
        }
    }
    bonus - total
}
`,
      reformatted: `/// Sum positive cells.
fn score(cells:&[i32],bonus:i32)->i32{
    let mut total=0;
    for c in cells { if *c>0 { total+=c*2; } }
    total+bonus
}`
    },
    go: {
      label: "Go",
      grammar: "go",
      before: `package main

func score(cells []int, bonus int) int {
	total := 0
	for _, c := range cells {
		if c > 0 {
			total += c * 2
		}
	}
	return total + bonus
}
`,
      after: `package main

func score(cells []int, bonus int) int {
	// weight raised to 3, cells capped below 9
	total := 0
	for _, c := range cells {
		if c > 0 && c < 9 {
			total += c * 3
		}
	}
	return bonus - total
}
`,
      reformatted: `package main
// score sums positive cells.
func score(cells []int, bonus int) int { total := 0
	for _, c := range cells { if c > 0 { total += c*2 } }
	return (total + bonus) }
`
    },
    java: {
      label: "Java",
      grammar: "java",
      before: `class Game {
    static int score(int[] cells, int bonus) {
        int total = 0;
        for (int c : cells) {
            if (c > 0) total += c * 2;
        }
        return total + bonus;
    }
}
`,
      after: `class Game {
    static int score(int[] cells, int bonus) {
        // weight raised to 3, cells capped below 9
        int total = 0;
        for (int c : cells) {
            if (c > 0 && c < 9) total += c * 3;
        }
        return bonus - total;
    }
}
`,
      reformatted: `class Game { /** Sum positive cells. */
  static int score(int[] cells,int bonus){ int total=0;
    for (int c : cells) { if (c>0) total+=c*2; }
    return (total+bonus); } }`
    },
    c: {
      label: "C",
      grammar: "c",
      before: `int score(const int *cells, int n, int bonus) {
    int total = 0;
    for (int i = 0; i < n; i++) {
        if (cells[i] > 0) total += cells[i] * 2;
    }
    return total + bonus;
}
`,
      after: `int score(const int *cells, int n, int bonus) {
    /* weight raised to 3, cells capped below 9 */
    int total = 0;
    for (int i = 0; i < n; i++) {
        if (cells[i] > 0 && cells[i] < 9) total += cells[i] * 3;
    }
    return bonus - total;
}
`,
      reformatted: `int score(const int *cells,int n,int bonus){ // sum positive cells
  int total=0;
  for (int i=0;i<n;i++) { if (cells[i]>0) total+=cells[i]*2; }
  return (total+bonus); }`
    },
    cpp: {
      label: "C++",
      grammar: "cpp",
      before: `#include <vector>

int score(const std::vector<int>& cells, int bonus) {
    int total = 0;
    for (int c : cells) {
        if (c > 0) total += c * 2;
    }
    return total + bonus;
}
`,
      after: `#include <vector>

int score(const std::vector<int>& cells, int bonus) {
    // weight raised to 3, cells capped below 9
    int total = 0;
    for (int c : cells) {
        if (c > 0 && c < 9) total += c * 3;
    }
    return bonus - total;
}
`,
      reformatted: `#include <vector>
// Sum positive cells.
int score(const std::vector<int>& cells,int bonus){ int total=0;
  for (int c : cells) { if (c>0) total+=c*2; }
  return (total+bonus); }
`
    },
    c_sharp: {
      label: "C#",
      grammar: "c_sharp",
      before: `class Game {
    static int Score(int[] cells, int bonus) {
        int total = 0;
        foreach (var c in cells) {
            if (c > 0) total += c * 2;
        }
        return total + bonus;
    }
}
`,
      after: `class Game {
    static int Score(int[] cells, int bonus) {
        // weight raised to 3, cells capped below 9
        int total = 0;
        foreach (var c in cells) {
            if (c > 0 && c < 9) total += c * 3;
        }
        return bonus - total;
    }
}
`,
      reformatted: `class Game { /// <summary>Sum positive cells.</summary>
  static int Score(int[] cells,int bonus){ int total=0;
    foreach (var c in cells) { if (c>0) total+=c*2; }
    return (total+bonus); } }`
    },
    ruby: {
      label: "Ruby",
      grammar: "ruby",
      before: `def score(cells, bonus)
  total = 0
  cells.each do |c|
    total += c * 2 if c > 0
  end
  total + bonus
end
`,
      after: `def score(cells, bonus)
  # weight raised to 3, cells capped below 9
  total = 0
  cells.each do |c|
    total += c * 3 if c > 0 && c < 9
  end
  bonus - total
end
`,
      reformatted: `def score(cells,bonus) # sum positive cells
  total=0
  cells.each do |c|
      total+=c*2 if c>0
  end
  (total+bonus)
end`
    },
    php: {
      label: "PHP",
      grammar: "php",
      before: `<?php
function score($cells, $bonus) {
    $total = 0;
    foreach ($cells as $c) {
        if ($c > 0) $total += $c * 2;
    }
    return $total + $bonus;
}
`,
      after: `<?php
function score($cells, $bonus) {
    // weight raised to 3, cells capped below 9
    $total = 0;
    foreach ($cells as $c) {
        if ($c > 0 && $c < 9) $total += $c * 3;
    }
    return $bonus - $total;
}
`,
      reformatted: `<?php
/** Sum positive cells. */
function score($cells,$bonus){ $total=0;
  foreach ($cells as $c) { if ($c>0) $total+=$c*2; }
  return ($total+$bonus); }
`
    },
    kotlin: {
      label: "Kotlin",
      grammar: "kotlin",
      before: `fun score(cells: IntArray, bonus: Int): Int {
    var total = 0
    for (c in cells) {
        if (c > 0) total += c * 2
    }
    return total + bonus
}
`,
      after: `fun score(cells: IntArray, bonus: Int): Int {
    // weight raised to 3, cells capped below 9
    var total = 0
    for (c in cells) {
        if (c > 0 && c < 9) total += c * 3
    }
    return bonus - total
}
`,
      reformatted: `/** Sum positive cells. */
fun score(cells:IntArray,bonus:Int):Int{
    var total=0
    for (c in cells) { if (c>0) total+=c*2 }
    return (total+bonus)
}`
    },
    scala: {
      label: "Scala",
      grammar: "scala",
      before: `object Game {
  def score(cells: Seq[Int], bonus: Int): Int = {
    var total = 0
    for (c <- cells) {
      if (c > 0) total += c * 2
    }
    total + bonus
  }
}
`,
      after: `object Game {
  def score(cells: Seq[Int], bonus: Int): Int = {
    // weight raised to 3, cells capped below 9
    var total = 0
    for (c <- cells) {
      if (c > 0 && c < 9) total += c * 3
    }
    bonus - total
  }
}
`,
      reformatted: `object Game { /** Sum positive cells. */
  def score(cells:Seq[Int],bonus:Int):Int={
    var total=0
    for (c <- cells) { if (c>0) total+=c*2 }
    (total+bonus) } }`
    },
    zig: {
      label: "Zig",
      grammar: "zig",
      before: `fn score(cells: []const i32, bonus: i32) i32 {
    var total: i32 = 0;
    for (cells) |c| {
        if (c > 0) total += c * 2;
    }
    return total + bonus;
}
`,
      after: `fn score(cells: []const i32, bonus: i32) i32 {
    // weight raised to 3, cells capped below 9
    var total: i32 = 0;
    for (cells) |c| {
        if (c > 0 and c < 9) total += c * 3;
    }
    return bonus - total;
}
`,
      reformatted: `/// Sum positive cells.
fn score(cells:[]const i32,bonus:i32) i32 {
    var total:i32=0;
    for (cells) |c| { if (c>0) total+=c*2; }
    return (total+bonus);
}`
    }
  };
  return __toCommonJS(browser_entry_exports);
})();

if (typeof module !== "undefined") module.exports = AstDiffTS;
