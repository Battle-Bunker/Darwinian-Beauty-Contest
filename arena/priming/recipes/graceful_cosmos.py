# Example cosmos: a graceful labelling of the graph that n builds.
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
    deadline = time.time() + 0.65 * GAME["ms"] / 1000  # stop at 65%: no time left means no answer
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

    # Hill climbing: move a random dot u to a random free label x, and keep the move unless it
    # loses a difference. (About half the labels are free. The clock is read every 64 moves.)
    moves = 0
    while moves % 64 or time.time() < deadline:
        moves += 1
        u, x = random.randrange(VERTICES), random.randrange(top + 1)
        if owner[x] is not None:
            continue
        old, lost, found = label[u], 0, 0
        for w in neighbours[u]:
            d = abs(old - label[w])
            count[d] -= 1
            lost += count[d] == 0
        for w in neighbours[u]:
            d = abs(x - label[w])
            found += count[d] == 0
            count[d] += 1
        if found >= lost:
            label[u], owner[x], owner[old] = x, u, None
        else:
            for w in neighbours[u]:  # undo
                count[abs(x - label[w])] -= 1
                count[abs(old - label[w])] += 1
    return dict(nodes=VERTICES, edges=[list(pair) for pair in links], labels=label)
