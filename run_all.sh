#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_DIR="${ROOT_DIR}/ros2_ws"
PIXI_BIN="${PIXI_BIN:-/home/hifiberry/.pixi/bin/pixi}"
MOCK_MODE="${MOCK_MODE:-true}"
WEB_PORT="${WEB_PORT:-18080}"

if [[ ! -x "${PIXI_BIN}" ]]; then
  echo "pixi not found or not executable: ${PIXI_BIN}" >&2
  exit 1
fi

cd "${WS_DIR}"

"${PIXI_BIN}" run build
"${PIXI_BIN}" run bash -lc \
  'source install/setup.bash && ros2 launch chicken_bringup chicken.launch.py "$@"' \
  bash mock_mode:="${MOCK_MODE}" web_port:="${WEB_PORT}" "$@"
