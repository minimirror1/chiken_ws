#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-18080}"
PIXI_BIN="${PIXI_BIN:-/home/hifiberry/.pixi/bin/pixi}"
ROS_LOG_DIR="${ROS_LOG_DIR:-/tmp/ros2_chicken_logs}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

find_port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "${PORT}" 2>/dev/null || true
    return
  fi

  return 0
}

stop_port_server() {
  local pids
  pids="$(find_port_pids | tr '\n' ' ' | xargs || true)"

  if [[ -z "${pids}" ]]; then
    echo "No server is listening on port ${PORT}."
    return
  fi

  echo "Stopping process on port ${PORT}: ${pids}"
  kill ${pids}

  for _ in {1..20}; do
    if [[ -z "$(find_port_pids | tr '\n' ' ' | xargs || true)" ]]; then
      echo "Port ${PORT} is free."
      return
    fi
    sleep 0.2
  done

  echo "Process did not stop cleanly. Forcing stop: ${pids}"
  kill -KILL ${pids}
}

if [[ ! -x "${PIXI_BIN}" ]]; then
  echo "Pixi executable not found: ${PIXI_BIN}" >&2
  exit 1
fi

mkdir -p "${ROS_LOG_DIR}"
export ROS_LOG_DIR

cd "${WS_DIR}"

stop_port_server

echo "Building animatronic_web..."
"${PIXI_BIN}" run colcon build --packages-select animatronic_web

echo "Starting animatronic_web on port ${PORT}..."
exec "${PIXI_BIN}" run bash -lc "source install/setup.bash && ros2 run animatronic_web web_server_node --ros-args -p web.port:=${PORT}"
