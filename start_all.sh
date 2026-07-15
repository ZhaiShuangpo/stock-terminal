#!/bin/bash

# 大A盯盘终端 - 一键启动脚本
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

ensure_port_available() {
  local port="$1"
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $port 已被其他进程占用。请先确认该服务后再停止，脚本不会强制终止它。"
    exit 1
  fi
}

ensure_port_available 8000
ensure_port_available 5173

wait_for_url() {
  local name="$1"
  local url="$2"
  for _ in {1..40}; do
    if curl --fail --silent --max-time 1 "$url" >/dev/null 2>&1; then
      echo "$name 已就绪。"
      return 0
    fi
    sleep 0.5
  done
  echo "$name 启动超时，请检查日志。"
  return 1
}

cleanup_failed_start() {
  "$ROOT_DIR/stop_all.sh" >/dev/null 2>&1 || true
}

trap cleanup_failed_start ERR

echo "正在启动后端行情引擎 (Port 8000)..."
(
  cd "$ROOT_DIR/backend"
  nohup venv/bin/python -u main.py > backend.log 2>&1 &
  echo $! > "$ROOT_DIR/backend.pid"
)

wait_for_url "后端行情引擎" "http://127.0.0.1:8000/api/health"

echo "正在启动前端交互界面 (Port 5173)..."
(
  cd "$ROOT_DIR/frontend"
  # Start Vite directly so the PID file identifies the actual listening
  # process instead of an npm wrapper that can leave an orphan child behind.
  nohup node node_modules/vite/bin/vite.js --host 0.0.0.0 > frontend.log 2>&1 &
  echo $! > "$ROOT_DIR/frontend.pid"
)

wait_for_url "前端交互界面" "http://127.0.0.1:5173"
trap - ERR

echo "---------------------------------------"
echo "✅ 服务启动成功！"
echo "👉 请访问: http://localhost:5173"
echo "📝 查看后端日志: tail -f backend/backend.log"
echo "📝 查看前端日志: tail -f frontend/frontend.log"
echo "---------------------------------------"
