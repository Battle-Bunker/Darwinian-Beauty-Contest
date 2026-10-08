# What a Python program may write: no reaching into the interpreter's internals. Checked on every program
# when it is checked or submitted (server/games.js, through this file as a script) and again by the runner
# before it runs a program (py_runner.py imports check()).
#   python3 py_rules.py  < {"code": "..."}  ->  {"errors": ["line 3: ...", ...]}
#
# The rules (RULES.md, "What programs can use"):
#   - No dunder attributes (x.__class__, f.__globals__, ...) except a few harmless ones: __name__,
#     __qualname__, __doc__, __module__, and the protocol methods (__init__, __eq__, __iter__, __add__, ...),
#     so super().__init__() and friends work. Classes may define any dunder method.
#   - No dunder names (__builtins__, __build_class__, ...) except __name__, __import__ and __debug__; outside
#     class bodies, nothing may be defined or assigned under a dunder name.
#   - No frame, traceback, generator or closure internals (f_back, f_globals, tb_frame, gi_frame,
#     cell_contents, ...).
#   - str.format and format_map only on a literal string, without attribute lookups in its fields (use an
#     f-string).
#   - eval, exec, compile, globals, locals, vars, open, input, breakpoint and help don't exist.
# The runner backs this up at run time: getattr, setattr, delattr, hasattr and dir refuse the same names,
# operator.attrgetter and methodcaller too, and modules are views of their public names. It is a best
# effort, not a security sandbox.
import ast
import json
import re
import string
import sys

DUNDER = re.compile(r"^__\w+__$")

# Dunder methods that only do what the operator or protocol they implement does.
PROTOCOL = {
    "__init__", "__new__", "__repr__", "__str__", "__bytes__", "__format__", "__hash__", "__bool__", "__len__",
    "__iter__", "__next__", "__reversed__", "__contains__", "__getitem__", "__setitem__", "__delitem__",
    "__missing__", "__call__", "__enter__", "__exit__", "__eq__", "__ne__", "__lt__", "__le__", "__gt__", "__ge__",
    "__neg__", "__pos__", "__abs__", "__invert__", "__round__", "__trunc__", "__floor__", "__ceil__", "__index__",
    "__int__", "__float__", "__complex__", "__post_init__", "__copy__", "__deepcopy__", "__aiter__", "__anext__",
    "__aenter__", "__aexit__", "__await__", "__length_hint__",
} | {f"__{p}{op}__" for op in ("add", "sub", "mul", "matmul", "truediv", "floordiv", "mod", "divmod", "pow",
                                 "lshift", "rshift", "and", "xor", "or") for p in ("", "r", "i")}
SAFE_ATTRS = PROTOCOL | {"__name__", "__qualname__", "__doc__", "__module__"}
SAFE_NAMES = {"__name__", "__import__", "__debug__"}

# Frame, traceback, generator, coroutine and closure internals: they lead to the runner's globals.
INTERNALS = {
    "f_back", "f_builtins", "f_code", "f_globals", "f_lasti", "f_lineno", "f_locals", "f_trace", "f_trace_lines",
    "f_trace_opcodes", "tb_frame", "tb_lasti", "tb_lineno", "tb_next", "gi_code", "gi_frame", "gi_running",
    "gi_yieldfrom", "gi_suspended", "cr_await", "cr_code", "cr_frame", "cr_origin", "cr_running", "cr_suspended",
    "ag_await", "ag_code", "ag_frame", "ag_running", "cell_contents",
}

GONE = {"eval", "exec", "compile", "globals", "locals", "vars", "open", "input", "breakpoint", "help"}


def refused_attr(name):
    """Why attribute `name` may not be read or written, or None."""
    if DUNDER.match(name) and name not in SAFE_ATTRS:
        return f"programs may not use dunder attributes like .{name} (only __name__, __qualname__, __doc__, __module__ and operator methods such as __init__)"
    if name in INTERNALS:
        return f".{name} is the interpreter's internals, which programs may not use"
    return None


def format_fields_error(s):
    """Why a literal format string's fields are refused (attribute lookups), or None."""
    try:
        for _, field, spec, _ in string.Formatter().parse(s):
            if field and "." in field:
                return f"a format field with an attribute lookup ({{{field}}}): use an f-string"
            if spec and "{" in spec:
                err = format_fields_error(spec)
                if err:
                    return err
    except ValueError:
        return None  # not a valid format string: str.format will raise on its own
    return None


class Checker(ast.NodeVisitor):
    def __init__(self, bound):
        self.errors = []
        self.scopes = ["module"]  # module | class | function
        self.bound = bound        # every name the program binds anywhere

    def fail(self, node, msg):
        self.errors.append(f"line {getattr(node, 'lineno', '?')}: {msg}")

    def in_class(self):
        return self.scopes[-1] == "class"

    def defined_name(self, node, name):
        if DUNDER.match(name) and not self.in_class():
            self.fail(node, f"programs may not define dunder names ({name}) outside a class body")

    def visit_ClassDef(self, node):
        self.defined_name(node, node.name)
        for d in node.decorator_list + node.bases + [k.value for k in node.keywords]:
            self.visit(d)
        self.scopes.append("class")
        for stmt in node.body:
            self.visit(stmt)
        self.scopes.pop()

    def visit_FunctionDef(self, node):
        self.defined_name(node, node.name)
        for d in node.decorator_list:
            self.visit(d)
        self.visit(node.args)
        if node.returns:
            self.visit(node.returns)
        self.scopes.append("function")
        for stmt in node.body:
            self.visit(stmt)
        self.scopes.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node):
        self.visit(node.args)
        self.scopes.append("function")
        self.visit(node.body)
        self.scopes.pop()

    def visit_arg(self, node):
        if DUNDER.match(node.arg):
            self.fail(node, f"programs may not use dunder names ({node.arg}) as parameters")
        self.generic_visit(node)

    def visit_Name(self, node):
        name = node.id
        if DUNDER.match(name):
            if isinstance(node.ctx, ast.Load):
                if name not in SAFE_NAMES and not (self.in_class() and name in PROTOCOL):
                    self.fail(node, f"programs may not use the name {name}")
            elif not self.in_class():
                self.fail(node, f"programs may not assign to dunder names ({name}) outside a class body")
        elif name in GONE and isinstance(node.ctx, ast.Load) and name not in self.bound:
            self.fail(node, f"{name}() is not available in this game")

    def visit_Attribute(self, node):
        why = refused_attr(node.attr)
        if why:
            self.fail(node, why)
        if node.attr in ("format", "format_map"):
            v = node.value
            if not (isinstance(v, ast.Constant) and isinstance(v.value, str)):
                self.fail(node, f"str.{node.attr} only on a literal string (use an f-string)")
            else:
                err = format_fields_error(v.value)
                if err:
                    self.fail(node, err)
        self.generic_visit(node)

    def visit_Global(self, node):
        for n in node.names:
            if DUNDER.match(n):
                self.fail(node, f"programs may not declare dunder names ({n}) global")

    visit_Nonlocal = visit_Global

    def visit_alias(self, node):
        for n in (node.name.split(".")[-1], node.asname):
            if n and DUNDER.match(n):
                self.fail(node, f"programs may not import dunder names ({n})")

    def visit_MatchClass(self, node):
        for k in node.kwd_attrs:
            why = refused_attr(k)
            if why:
                self.fail(node, why)
        self.generic_visit(node)


def bound_names(tree):
    names = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            names.add(n.id)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.arg):
            names.add(n.arg)
        elif isinstance(n, ast.alias):
            names.add(n.asname or n.name.split(".")[0])
    return names


def check(source):
    """The rule breaches in a program's source, as messages (a syntax error is left to the compiler)."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return []
    c = Checker(bound_names(tree))
    c.visit(tree)
    return c.errors


if __name__ == "__main__":
    job = json.loads(sys.stdin.read())
    sys.stdout.write(json.dumps({"errors": check(job.get("code", ""))}))
