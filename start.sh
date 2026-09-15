#!/usr/bin/env bash
# Run CareerPilot locally. Keep this terminal open while you use it.
cd "$(dirname "$0")" || exit 1
python3 run_local.py "$@"
