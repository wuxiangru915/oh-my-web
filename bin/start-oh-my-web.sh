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

# ── Deleted providers: unset the env vars that feed providers the user has
# deleted from the web UI (models module → Delete provider). The deletion is
# persisted in deleted-providers.json; a restart of this script is what makes
# it take effect at the runtime level, not just the UI.
DELETED_FILE="$ISOLATED_AGENT_DIR/deleted-providers.json"
if [[ -f "$DELETED_FILE" ]]; then
  DELETED_PROVIDERS=$(python3 -c "import json,sys; print(' '.join(json.load(open(sys.argv[1]))))" "$DELETED_FILE" 2>/dev/null || true)
  for PID in $DELETED_PROVIDERS; do
    case "$PID" in
      deepseek) unset DEEPSEEK_API_KEY ;;
      google) unset GEMINI_API_KEY GOOGLE_API_KEY ;;
      xiaomi) unset XIAOMI_API_KEY XIAOMI_TOKEN_PLAN_CN_API_KEY XIAOMI_TOKEN_PLAN_AMS_API_KEY XIAOMI_TOKEN_PLAN_SGP_API_KEY ;;
      openai) unset OPENAI_API_KEY ;;
      anthropic) unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ;;
      openrouter) unset OPENROUTER_API_KEY ;;
      groq) unset GROQ_API_KEY ;;
      mistral) unset MISTRAL_API_KEY ;;
      moonshot) unset MOONSHOT_API_KEY ;;
      kimi) unset KIMI_API_KEY ;;
      xai) unset XAI_API_KEY ;;
      nvidia) unset NVIDIA_API_KEY ;;
      together) unset TOGETHER_API_KEY ;;
      fireworks) unset FIREWORKS_API_KEY ;;
      cerebras) unset CEREBRAS_API_KEY ;;
      baseten) unset BASETEN_API_KEY ;;
      qwen) unset QWEN_TOKEN_PLAN_API_KEY QWEN_TOKEN_PLAN_CN_API_KEY ;;
      minimax) unset MINIMAX_API_KEY MINIMAX_CN_API_KEY ;;
      huggingface) unset HF_TOKEN ;;
    esac
  done
fi

MODE="${1:-dev}"
cd "$(dirname "$0")/.."
case "$MODE" in
  dev)
    npm run dev
    ;;
  build)
    npm run build
    ;;
  start)
    npm run start
    ;;
  *)
    echo "usage: $0 [dev|build|start]" >&2
    exit 1
    ;;
esac
