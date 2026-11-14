#!/bin/bash
# hal.sh: the easy way to drive Hal on the operator's Mac. A thin wrapper over `npm run hal -- ...`.
# Details on what each command does: docs/hal/OPERATIONS.md.
#
#   ./hal.sh                 status: launchd jobs, a run in progress, the latest report
#   ./hal.sh run [flags]     standalone: a full run now, in this terminal (Mac kept awake). Flags pass through:
#                              --report-only  --game <slug>  --kind fix|tuning|polish|feature  --max-tickets N
#                              --no-push  --billing api
#   ./hal.sh look            standalone: play and plan only; builds nothing, pushes nothing
#   ./hal.sh now             launchd: start the nightly job right now, in the background (then: ./hal.sh logs)
#   ./hal.sh stop            finish the current step, skip the rest, still write the note and report
#   ./hal.sh logs [server]   follow the nightly log (or the report server's log)
#   ./hal.sh restart-server  restart the report server (launchd), e.g. after a git pull changes Hal's code
#   ./hal.sh report          print the latest report
#   ./hal.sh install [--at HH:MM] | uninstall    add or remove the launchd jobs (nightly run + report server)
#   ./hal.sh <anything else> passed straight to `npm run hal -- ...` (tell, notes, undo, ship, drop, spend, serve, ...)
set -euo pipefail

cd "$(dirname "$0")"
export TSX_DISABLE_CACHE=1 # Hal must not load tsx's shared-tmp cache (see scripts/hal.ts)

HAL_DIR=.data/hal
NIGHTLY=com.gstudio.hal.nightly
SERVER=com.gstudio.hal.server
DOMAIN="gui/$(id -u)"

hal() { npm run -s hal -- "$@"; }

job_state() { # loaded/not installed, plus running if launchd has a pid for it
  if ! launchctl print "$DOMAIN/$1" >/dev/null 2>&1; then echo "not installed"; return; fi
  local pid
  pid=$(launchctl print "$DOMAIN/$1" 2>/dev/null | awk '$1 == "pid" { print $3; exit }')
  if [ -n "$pid" ]; then echo "loaded, running (pid $pid)"; else echo "loaded, idle"; fi
}

status() {
  local at
  at=$(/usr/libexec/PlistBuddy -c 'Print :StartCalendarInterval' "$HOME/Library/LaunchAgents/$NIGHTLY.plist" 2>/dev/null \
    | awk '/Hour/ { h = $3 } /Minute/ { m = $3 } END { if (h != "") printf "%02d:%02d", h, m }') || true
  echo "nightly run:   $(job_state "$NIGHTLY")${at:+ (daily at $at)}"
  echo "report server: $(job_state "$SERVER")"
  if [ -f "$HAL_DIR/run.lock" ]; then
    local pid
    pid=$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$HAL_DIR/run.lock")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "run:           in progress (pid $pid)"
    else echo "run:           none (stale lock; the next run takes it over)"; fi
  else
    echo "run:           none"
  fi
  if [ -f "$HAL_DIR/latest.json" ]; then
    sed -nE 's/.*"(runId|endedAt|reportMd)": *"([^"]*)".*/latest \1: \2/p' "$HAL_DIR/latest.json" \
      | sed 's/latest runId:/latest run:   /; s/latest endedAt:/ended:        /; s/latest reportMd:/report:       /'
  fi
}

cmd=${1:-status}
[ $# -gt 0 ] && shift
case "$cmd" in
  status) status ;;
  run) exec caffeinate -is npm run -s hal -- run "$@" ;;
  look) exec caffeinate -is npm run -s hal -- run --report-only "$@" ;;
  now)
    launchctl print "$DOMAIN/$NIGHTLY" >/dev/null 2>&1 || { echo "nightly job not installed: ./hal.sh install" >&2; exit 1; }
    launchctl kickstart "$DOMAIN/$NIGHTLY"
    echo "started the nightly job; follow it with: ./hal.sh logs"
    ;;
  restart-server)
    launchctl print "$DOMAIN/$SERVER" >/dev/null 2>&1 || { echo "report server not installed: ./hal.sh install" >&2; exit 1; }
    launchctl kickstart -k "$DOMAIN/$SERVER"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      state=$(job_state "$SERVER"); case "$state" in *running*) break ;; esac; sleep 0.5
    done
    echo "report server: $state"
    ;;
  logs)
    case "${1:-nightly}" in
      nightly) exec tail -n 50 -f "$HAL_DIR/logs/nightly.log" ;;
      server) exec tail -n 50 -f "$HAL_DIR/logs/server.log" ;;
      *) echo "usage: ./hal.sh logs [nightly|server]" >&2; exit 2 ;;
    esac
    ;;
  report)
    report=$(sed -n 's/.*"reportMd": *"\([^"]*\)".*/\1/p' "$HAL_DIR/latest.json" 2>/dev/null || true)
    [ -n "$report" ] && [ -f "$report" ] || { echo "no report yet" >&2; exit 1; }
    cat "$report"
    ;;
  help|-h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) hal "$cmd" "$@" ;;
esac
