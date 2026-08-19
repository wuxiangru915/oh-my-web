#!/usr/bin/env bash
# oh-my-web 启动脚本
#
# 与 30141 上运行的原版 pi-web 共用同一 agent 数据目录（~/.pi/agent），
# 会话/模型/认证完全共享，不做隔离。
# 端口仍使用 30142（见 package.json scripts）。
set -euo pipefail

export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.project/omw-agent}"

MODE="${1:-dev}"
cd "$(dirname "$0")/.."

PORT="30142"
URL="http://127.0.0.1:$PORT"
LOG_FILE="/tmp/omw-main.log"
PID_FILE="/tmp/omw-main.pid"

find_pid() {
  ss -tlnp 2>/dev/null | grep ":$PORT" | grep -oP 'pid=\K[0-9]+' | head -1
}

is_running() {
  [ -n "$(find_pid)" ]
}

case "$MODE" in
  dev)
    npm run dev
    ;;
  build)
    NEXT_PUBLIC_APP_VERSION="$(date +%s)" npm run build
    ;;
  start)
    npm run start
    ;;
  daemon)
    if is_running; then
      echo "oh-my-web is already running on $URL (pid $(find_pid))."
      exit 0
    fi
    echo "Starting oh-my-web on $URL ..."
    nohup npm run start > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    # 等待端口就绪（最多 30s）
    for _ in $(seq 1 30); do
      if is_running; then
        echo "Started (pid $(find_pid)). Log: $LOG_FILE"
        exit 0
      fi
      sleep 1
    done
    echo "ERROR: service did not become ready in 30s. See $LOG_FILE" >&2
    exit 1
    ;;
  stop)
    pid="$(find_pid)"
    if [ -z "$pid" ]; then
      echo "oh-my-web is not running."
      rm -f "$PID_FILE"
      exit 0
    fi
    kill "$pid"
    for _ in $(seq 1 10); do
      if ! is_running; then break; fi
      sleep 1
    done
    if is_running; then
      kill -9 "$(find_pid)" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "Stopped."
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" daemon
    ;;
  status)
    if is_running; then
      echo "oh-my-web is running on $URL (pid $(find_pid))."
    else
      echo "oh-my-web is not running."
      exit 1
    fi
    ;;
  logs)
    if [ -f "$LOG_FILE" ]; then
      tail -n 50 "$LOG_FILE"
    else
      echo "No log file found ($LOG_FILE)."
    fi
    ;;
  *)
    echo "usage: $0 [dev|build|start|daemon|stop|restart|status|logs]" >&2
    exit 1
    ;;
esac
