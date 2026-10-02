# Calibration only: the strongest graceful-labelling orchid we could write for a 50 ms budget. Same answer
# format and the same hill climbing as arena/examples/v3/graceful_cosmos.py (move a dot to a free label,
# keep the move unless a difference is lost), with the speed-ups we found:
#   - local names for everything in the hot loop, perf_counter, the clock read every 128 moves
#   - spends 80% of its budget (the example cosmos stops at 65%)
# Things we tried that did NOT help: swapping labels with the dot that holds them (slower per move and
# no better), a greedy initial labelling, conflict-directed moves (move a dot on a repeated difference),
# aiming a move at a missing difference, simulated annealing, a third link per dot (no better separation).
import random
import time

V = 512


def flower(challenge):
    clock = time.perf_counter
    deadline = clock() + 0.8 * GAME["ms"] / 1000
    t = int(challenge) + 2**64
    links = [(0, 1)]
    for i in range(2, V):
        a = t % i
        b = t // i % (i - 1)
        if b >= a:
            b += 1
        links += [(a, i), (b, i)]
    E = len(links)
    adj = [[] for _ in range(V)]
    for a, b in links:
        adj[a].append(b)
        adj[b].append(a)
    lab = random.sample(range(E + 1), V)
    free = [True] * (E + 1)
    for x in lab:
        free[x] = False
    cnt = [0] * (E + 1)
    for a, b in links:
        cnt[abs(lab[a] - lab[b])] += 1
    rr = random.randrange
    it = 0
    while True:
        it += 1
        if not it & 127 and clock() > deadline:
            break
        x = rr(E + 1)
        if not free[x]:
            continue
        u = rr(V)
        old = lab[u]
        nb = [lab[w] for w in adj[u]]
        lost = 0
        for y in nb:
            d = old - y if old > y else y - old
            c = cnt[d] - 1
            cnt[d] = c
            if not c:
                lost += 1
        found = 0
        for y in nb:
            d = x - y if x > y else y - x
            c = cnt[d]
            if not c:
                found += 1
            cnt[d] = c + 1
        if found >= lost:
            lab[u] = x
            free[x] = False
            free[old] = True
        else:
            for y in nb:
                cnt[x - y if x > y else y - x] -= 1
                cnt[old - y if old > y else y - old] += 1
    return dict(nodes=V, edges=[list(e) for e in links], labels=lab)
