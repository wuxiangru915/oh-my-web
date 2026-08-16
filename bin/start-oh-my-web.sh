#!/usr/bin/env bash
# oh-my-web 启动脚本（测试用）
#
# 与 30141 上运行的原版 pi-web 完全隔离：
#   - 端口使用 30142（见 package.json scripts）
#   - agent 数据目录指向 ~/.pi/oh-my-web-agent（不碰 ~/.pi/agent）
#
# 首次运行会自动把模型/认证等只读配置从 ~/.pi/agent 复制到隔离目录，
# 但 sessions 历史不会共享，避免任何写入冲突影响原版。
set -euo pipefail

ISOLATED_AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/oh-my-web-agent}"
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
  *)
    echo "usage: $0 [dev|build|start]" >&2
    exit 1
    ;;
esac
