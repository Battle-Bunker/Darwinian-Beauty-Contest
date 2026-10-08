#!/bin/sh
# Start an agent process contained (lib/cgroups.js): join the agents' cgroups, then become the command at the given nice.
# Runner-side, never in a workspace. Joining before exec means the command and everything it starts inherit the groups.
#   sh agent_exec.sh NICE DIRS COMMAND [ARGS...]     DIRS: cgroup directories joined by ":", or "-" for none
n="$1"; dirs="$2"; shift 2
if [ "$dirs" != "-" ]; then
  old_ifs="$IFS"; IFS=:
  for d in $dirs; do
    echo $$ > "$d/cgroup.procs" 2>/dev/null || echo "agent_exec: could not join $d" >&2
  done
  IFS="$old_ifs"
fi
if [ "$n" -gt 0 ] 2>/dev/null; then exec nice -n "$n" "$@"; fi
exec "$@"
