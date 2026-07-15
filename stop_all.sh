#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

stop_managed_service() {
  local name="$1"
  local pid_file="$2"
  local port="$3"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name 未发现由本脚本启动的进程。"
    return
  fi

  local pid
  pid="$(<"$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    local listener_pid
    listener_pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
    if [[ "$listener_pid" != "$pid" ]]; then
      echo "$name 的 PID $pid 并非端口 $port 的监听进程，拒绝停止可能无关的进程。"
      rm -f "$pid_file"
      return
    fi
    echo "正在停止 $name (PID $pid)..."
    kill "$pid"
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
  else
    echo "$name 的 PID 文件已过期。"
  fi
  rm -f "$pid_file"
}

stop_managed_service "后端服务" "$ROOT_DIR/backend.pid" 8000
stop_managed_service "前端服务" "$ROOT_DIR/frontend.pid" 5173

echo "服务停止完成。"
