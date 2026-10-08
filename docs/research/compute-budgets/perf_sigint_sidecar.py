#!/usr/bin/env python3
"""
A CPU-time alarm for a process that can't call perf_event_open itself (node): on request it opens a perf
task-clock event on one thread of another process with period R ns, and asks the kernel to send that process
a signal when the thread's on-CPU time reaches R (fasync: F_SETOWN, F_SETSIG). With SIGINT and node's
vm `breakOnSigint`, the running script is terminated and the runner lives on.

Protocol (lines on stdin -> one line on stdout each):
    arm TID R_NS OWNER_PID [SIGNAL]   -> ok OPEN_US        (SIGNAL defaults to SIGINT)
    read                              -> ok COUNT_NS       (the thread's task clock since arming)
    disarm                            -> ok COUNT_NS       (the same, then the event is closed)
    quit
"""
import fcntl, os, signal, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

fd = None
keep = C.perf_open(0, disabled=True)  # keeps perf's scheduler hooks switched on, so each open is cheap
for line in sys.stdin:
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "arm":
        t = time.perf_counter_ns()
        tid, r_ns, owner = int(parts[1]), int(parts[2]), int(parts[3])
        sig = getattr(signal, parts[4]) if len(parts) > 4 else signal.SIGINT
        try:
            if fd is not None:
                os.close(fd)
            # One-shot: opened disabled, then enabled for exactly one overflow (PERF_EVENT_IOC_REFRESH 1),
            # so a thread that runs on after the alarm doesn't get a second signal R later.
            fd = C.perf_open(tid, period_ns=r_ns, disabled=True)
            C.perf_signal_on_overflow(fd, owner, sig)
            fcntl.ioctl(fd, C.PERF_EVENT_IOC_REFRESH, 1)
            reply = f"ok {(time.perf_counter_ns() - t) / 1000:.1f}"
        except OSError as e:
            fd, reply = None, f"error {e}"
    elif parts[0] == "read":
        reply = f"ok {C.perf_read(fd) if fd is not None else -1}"
    elif parts[0] == "disarm":
        n = C.perf_read(fd) if fd is not None else -1
        if fd is not None:
            os.close(fd)
            fd = None
        reply = f"ok {n}"
    elif parts[0] == "quit":
        break
    else:
        reply = "error unknown"
    sys.stdout.write(reply + "\n")
    sys.stdout.flush()
