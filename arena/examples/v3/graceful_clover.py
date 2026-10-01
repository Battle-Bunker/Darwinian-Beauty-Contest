# Example clover: a graceful labelling of the graph that n builds.
#
# The challenge n builds a graph with VERTICES dots. Dot 1 links to dot 0, and every later dot i links
# back to two different earlier dots chosen from n: 2 * VERTICES - 3 links in all.
# The flower gives every dot a different label from 0 to the number of links, and the score is how many
# DIFFERENT differences |label(a) - label(b)| its links show. If all differences were different the
# labelling would be "graceful". That is rarely possible here, so the score counts how close it gets.
# A bee rebuilds the graph and counts the differences, which is quick. Getting the count high takes a
# long search, and the longer the search runs the higher it gets.
import random
import time

VERTICES = 512


def build_links(n):
    t = n + 2**64  # an offset, so that small and negative n also give scrambled graphs
    links = [(0, 1)]
    for i in range(2, VERTICES):
        first = t % i
        second = t // i % (i - 1)  # one of the other i - 1 earlier dots
        if second >= first:
            second += 1
        links += [(first, i), (second, i)]
    return links


def flower(challenge):
    deadline = time.time() + 0.6 * GAME["ms"] / 1000
    links = build_links(int(challenge))
    top = len(links)  # labels come from 0..top
    neighbours = [[] for _ in range(VERTICES)]
    for a, b in links:
        neighbours[a].append(b)
        neighbours[b].append(a)

    label = random.sample(range(top + 1), VERTICES)
    owner = [None] * (top + 1)  # owner[x]: the dot labelled x, if any
    for v, x in enumerate(label):
        owner[x] = v
    count = [0] * (top + 1)  # count[d]: how many links show the difference d
    for a, b in links:
        count[abs(label[a] - label[b])] += 1

    def relabel(u, x):
        # Give dot u the label x; whoever had x takes u's old label. Returns the change in the
        # number of different differences.
        v = owner[x]
        touched = [(u, w) for w in neighbours[u]]
        if v is not None:
            touched += [(v, w) for w in neighbours[v] if w != u]
        gain = 0
        for a, b in touched:
            d = abs(label[a] - label[b])
            count[d] -= 1
            gain -= count[d] == 0
        old = label[u]
        label[u], owner[x] = x, u
        if v is not None:
            label[v] = old
        owner[old] = v
        for a, b in touched:
            d = abs(label[a] - label[b])
            gain += count[d] == 0
            count[d] += 1
        return gain

    # Hill climbing: try a random change, keep it unless it loses a difference.
    while time.time() < deadline:
        u, x = random.randrange(VERTICES), random.randrange(top + 1)
        old = label[u]
        if x != old and relabel(u, x) < 0:
            relabel(u, old)
    return dict(nodes=VERTICES, edges=[list(link) for link in links], labels=label)
