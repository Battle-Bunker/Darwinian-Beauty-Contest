"""Launch a team's scaffold under resource limits, then become it (exec). Runner-side, never in a workspace.
    python3 scaffold_launch.py '<limits json>' <entry.py>
limits: {"memMB", "cpuSeconds", "fileMB", "nice"}. The runner also throttles its CPU share while it runs."""
import json
import os
import resource
import sys

lim = json.loads(sys.argv[1])
entry = sys.argv[2]
mem = int(lim.get("memMB", 1024)) * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
cpu = int(lim.get("cpuSeconds", 600))
resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 5))
fsize = int(lim.get("fileMB", 200)) * 1024 * 1024
resource.setrlimit(resource.RLIMIT_FSIZE, (fsize, fsize))
resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
os.nice(int(lim.get("nice", 15)))
os.execv(sys.executable, [sys.executable, "-u", "-s", entry])
