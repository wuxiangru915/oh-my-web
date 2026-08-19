#!/usr/bin/env bash
# oh-my-web 启动脚本
#
# 与 30141 上运行的原版 pi-web 完全隔离：
#   - 端口使用 30142（见 package.json scripts）
#   - agent 数据目录指向 ~/.pi/oh-my-web-agent（不碰 ~/.pi/agent）
#
# 首次运行会自动把模型/认证等只读配置从 ~/.pi/agent 复制到隔离目录，
# 但 sessions 历史不会共享，避免任何写入冲突影响原版。
set -euo pipefail

ISOLATED_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.project/omw-agent}"
SOURCE_AGENT_DIR="$HOME/.pi/agent"

mkdir -p "$ISOLATED_AGENT_DIR"

# 复制只读配置（已有则跳过，避免覆盖用户在隔离目录中的改动）
for f in auth.json models.json models-store.json settings.json trust.json; do
  if [[ -f "$SOURCE_AGENT_DIR/$f" && ! -f "$ISOLATED_AGENT_DIR/$f" ]]; then
    cp -p "$SOURCE_AGENT_DIR/$f" "$ISOLATED_AGENT_DIR/$f" 2>/dev/null || true
  fi
done

# 子目录（bin 等工具链）做符号链接，仅缺失时创建
for d in bin npm extensions; do
  if [[ -d "$SOURCE_AGENT_DIR/$d" && ! -e "$ISOLATED_AGENT_DIR/$d" ]]; then
    ln -s "$SOURCE_AGENT_DIR/$d" "$ISOLATED_AGENT_DIR/$d" 2>/dev/null || true
  fi
done

export PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR"

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
