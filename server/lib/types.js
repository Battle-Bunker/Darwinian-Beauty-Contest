// Challenge/response value types. A type is one of:
//   int | float | bool | str | list[T]
// Values travel as JSON. Limits keep every value small and JSON-safe.

const MAX_INT = Number.MAX_SAFE_INTEGER;

export function parseType(s) {
  const t = String(s || "").replace(/\s+/g, "");
  if (["int", "float", "bool", "str"].includes(t)) return { kind: t };
  const m = t.match(/^list\[(.+)\]$/);
  if (m) return { kind: "list", of: parseType(m[1]) };
  throw new Error(`Unknown type "${s}" (use int, float, bool, str or list[T])`);
}

export const typeToString = (t) => (t.kind === "list" ? `list[${typeToString(t.of)}]` : t.kind);

/** Returns null when `v` fits type `t`, else a short reason. */
export function checkValue(t, v, maxLen, path = "value") {
  switch (t.kind) {
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) return `${path} must be an int`;
      if (Math.abs(v) > MAX_INT) return `${path} is outside ±${MAX_INT}`;
      return null;
    case "float":
      if (typeof v !== "number" || !Number.isFinite(v)) return `${path} must be a finite number`;
      return null;
    case "bool":
      return typeof v === "boolean" ? null : `${path} must be true/false`;
    case "str":
      if (typeof v !== "string") return `${path} must be a string`;
      return v.length > maxLen ? `${path} is longer than ${maxLen} characters` : null;
    case "list":
      if (!Array.isArray(v)) return `${path} must be a list`;
      if (v.length > maxLen) return `${path} has more than ${maxLen} items`;
      for (let i = 0; i < v.length; i++) {
        const e = checkValue(t.of, v[i], maxLen, `${path}[${i}]`);
        if (e) return e;
      }
      return null;
  }
  return `${path}: unknown type`;
}

/** A simple valid example value, used by starter programs and docs. */
export function exampleValue(t) {
  return { int: 42, float: 0.5, bool: true, str: "hello" }[t.kind] ?? [exampleValue(t.of)];
}
