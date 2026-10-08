# An arrangement flower: one hard search whose result shows both which flower it is and how much it spent.
#
# The bee's challenge c seeds 192 random pairs of the 48 nodes, in two alternating classes. The flower places the
# nodes in a line (node v at position p[v]) and tries to put each pair of class k exactly T[k] positions apart:
# it lowers sum ||p[u] - p[v]| - T[k]|. Two crossing sets of distance targets on one line are hard to satisfy
# (each alone is NP-hard), cheap to check, and get better the longer the search runs. T is the flower's
# profile; how close it gets shows its wealth. The response is one string label, one character per node,
# chr(35 + p[v]): 85 bytes of JSON, since every byte costs energy.
#
# Paste the whole file as your flower. BURN, PERCENT and T are your team's choice:
#   BURN     the share of R spent on the search: at least 0.2 (the cooperators' floor), the same on every call
#            of a version (a fixed share of R is what lets a bee read your wealth), and below 0.9, because the
#            flower doesn't stop itself short of R.
#   PERCENT  the nectar percent: at least 20.
#   T        two target distances, each from 0 to 47. Measured on the real runner, a bee reads targets up to
#            about 20 within 1 to 2.5 (one response's spread) and larger ones within 3 to 4.5.
#
# Start-up (the program, the seed and the 192 pairs) takes about 1.0 ms of CPU before the search begins, so a
# BURN × R below about 1 ms gets no search, and at R near 1 ms about 4 calls in 10 run out of CPU.
#
# R is CPU time: the call is stopped when its CPU reaches R, and time.sleep does nothing. Budget with
# process_time(), which reads 0 as the call starts (the program's own start-up included), never with the wall
# clock: under load, wall time runs ahead of CPU and would cut the search short.
from random import *
from time import *

BURN = 0.6          # the share of R spent on the search
PERCENT = 50        # the nectar percent
T = 8, 32           # the profile: the target distance for each class of pairs


def flower(c):
    end = BURN * GAME["ms"] / 1e3                   # seconds of CPU to search for
    seed(c)                                         # the pairs come from the challenge
    r = range(48)
    p = [x + 35 for x in r]                         # each node's position, plus 35 (its character code)
    inc = [[] for _ in r]                           # per node: (other node, target distance)
    for t in T * 96:
        u, v = sample(r, 2)
        inc[u] += (v, t),
        inc[v] += (u, t),
    while process_time() < end:
        u, v = sample(r, 2)
        # The change in cost if u and v swap places (a pair joining u and v keeps its distance, so it is left
        # out). Accept the swap when the change is below a random threshold that cools to 0 as the CPU runs out.
        if sum(abs(abs(p[b] - p[y]) - t) - abs(abs(p[a] - p[y]) - t) for a, b in ((u, v), (v, u)) for y, t in inc[a] if y != b) < randrange(9) * (1 - process_time() / end):
            p[u], p[v] = p[v], p[u]
    return {"nodes": 1, "edges": [], "labels": [bytes(p).decode()]}, PERCENT
