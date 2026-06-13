#!/usr/bin/env bash
# ============================================================
# safe-refactor.sh — 盲训/量化拆分重构安全网
# ============================================================
# 目的：在隔离的 git 分支 + 隔离的数据目录上做拆分实验；
# 任何时刻 `./scripts/safe-refactor.sh rollback` 即可
# 完整回退到主分支与原始数据库。
#
# 用法：
#   ./scripts/safe-refactor.sh start     创建 refactor 分支 + 复制 DB
#   ./scripts/safe-refactor.sh dev       打印在隔离数据上启动 dev 的命令
#   ./scripts/safe-refactor.sh status    查看分支/DB 状态
#   ./scripts/safe-refactor.sh reset     重新从原始 DB 复制（保留分支）
#   ./scripts/safe-refactor.sh verify    检查 DB 完整性
#   ./scripts/safe-refactor.sh rollback  切回 main，删除分支和隔离目录
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH_NAME="refactor/split-blind-and-quant"
MAIN_BRANCH="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || echo main)"

PRODUCT_NAME="stock-trading-simulator"
PROD_DATA_DIR="$HOME/Library/Application Support/$PRODUCT_NAME"
PROD_DB="$PROD_DATA_DIR/stock-trading.db"
PROD_BLIND_DB="$PROD_DATA_DIR/blind-training.db"

ISOLATE_DIR_NAME="${PRODUCT_NAME}-refactor"
ISOLATE_ROOT="$HOME/Library/Application Support/$ISOLATE_DIR_NAME"
ISOLATE_DB="$ISOLATE_ROOT/stock-trading.db"
ISOLATE_BLIND_DB="$ISOLATE_ROOT/blind-training.db"
ISOLATE_MARKER="$ISOLATE_ROOT/.refactor-snapshot"

log() { printf "\033[1;34m[refactor]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[refactor]\033[0m %s\n" "$*" >&2; }
err() { printf "\033[1;31m[refactor]\033[0m %s\n" "$*" >&2; }

require_clean_tree() {
  if ! git diff --quiet HEAD 2>/dev/null; then
    err "工作区有未提交修改。请先 git stash 或 git commit 后再继续。"
    exit 1
  fi
  if ! git diff --cached --quiet HEAD 2>/dev/null; then
    err "暂存区有未提交修改。请先 git commit 或 git reset 后再继续。"
    exit 1
  fi
}

ensure_repo() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    err "当前目录不是 git 仓库：$REPO_ROOT"
    exit 1
  fi
}

ensure_production_db() {
  if [[ ! -f "$PROD_DB" ]]; then
    err "生产 DB 不存在：$PROD_DB"
    err "请先正常运行一次桌面端，让 Electron 创建 stock-trading.db。"
    exit 1
  fi
}

copy_databases() {
  mkdir -p "$ISOLATE_ROOT"
  log "复制生产 DB → $ISOLATE_ROOT"
  cp -p "$PROD_DB" "$ISOLATE_DB"
  if [[ -f "$PROD_BLIND_DB" ]]; then
    cp -p "$PROD_BLIND_DB" "$ISOLATE_BLIND_DB"
    log "  - blind-training.db 已复制"
  else
    warn "  - blind-training.db 不存在，跳过"
  fi

  cat > "$ISOLATE_MARKER" <<EOF
snapshot_at=$(date +%s)
source_db=$PROD_DB
source_blind_db=$PROD_BLIND_DB
git_head=$(git rev-parse HEAD)
EOF
  log "已写入 snapshot 标记：$ISOLATE_MARKER"
}

cmd_start() {
  ensure_repo
  require_clean_tree
  ensure_production_db

  local current_branch
  current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo detached)"

  if [[ "$current_branch" == "$BRANCH_NAME" ]]; then
    log "已在 $BRANCH_NAME 分支，跳过创建。"
  elif git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    log "分支 $BRANCH_NAME 已存在，切换过去。"
    git checkout "$BRANCH_NAME"
  else
    log "从 $MAIN_BRANCH 创建新分支 $BRANCH_NAME"
    git checkout "$MAIN_BRANCH"
    git pull --ff-only || warn "无法 fast-forward 拉取远程，继续使用本地 main"
    git checkout -b "$BRANCH_NAME"
  fi

  copy_databases

  log ""
  log "✓ 隔离环境就绪"
  cmd_dev
}

cmd_dev() {
  log ""
  log "在隔离数据上启动桌面端（Electron 走 env 路径，Python 走 --db 路径）"
  log "================================================================"
  cat <<EOF
  # TS / Electron 主进程会读 STOCK_TRADING_DB_PATH（参考 [src/main/db.ts:7](src/main/db.ts)）
  STOCK_TRADING_DB_PATH="$ISOLATE_DB" \\
  TRADING_DB_PATH="$ISOLATE_DB" \\
  TRADING_MARKET_DB_PATH="$ISOLATE_DB" \\
  STOCK_TRADING_BLIND_DB_PATH="$ISOLATE_BLIND_DB" \\
  npm run dev
EOF
  log ""
  log "  # Python 训练脚本显式 --db 指向隔离库（参考 [python/trading_trainer/db_path.py:8](python/trading_trainer/db_path.py)）"
  cat <<EOF
  TRADING_DB_PATH="$ISOLATE_DB" \\
    python -m trading_trainer.cli train \\
      --db "$ISOLATE_DB" --task lightgbm
EOF
  log ""
  log "提示：dev 启动时主进程会把窗口放在 $(echo "$ISOLATE_ROOT") 的数据上，"
  log "      不会触碰 $PROD_DATA_DIR。安全网生效。"
}

cmd_status() {
  ensure_repo
  local branch
  branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo detached)"
  echo "分支: $branch"
  echo "生产数据: $PROD_DATA_DIR"
  echo "隔离数据: $ISOLATE_ROOT"
  if [[ -f "$ISOLATE_MARKER" ]]; then
    echo
    echo "--- snapshot 标记 ---"
    cat "$ISOLATE_MARKER"
  else
    warn "未发现 snapshot 标记；隔离目录可能不存在或被手动清空。"
  fi
  if [[ -f "$ISOLATE_DB" ]]; then
    echo
    echo "--- 隔离 DB 文件信息 ---"
    ls -lh "$ISOLATE_DB" 2>/dev/null || true
    [[ -f "$ISOLATE_BLIND_DB" ]] && ls -lh "$ISOLATE_BLIND_DB" 2>/dev/null || true
  fi
}

cmd_reset() {
  ensure_repo
  ensure_production_db
  require_clean_tree
  log "重新从生产 DB 复制到隔离目录（分支保持 $BRANCH_NAME）"
  copy_databases
}

cmd_verify() {
  log "校验 DB 完整性（PRAGMA integrity_check）"
  if [[ ! -f "$ISOLATE_DB" ]]; then
    err "隔离 DB 不存在：$ISOLATE_DB"
    exit 1
  fi
  if command -v sqlite3 >/dev/null 2>&1; then
    local main_result blind_result
    main_result="$(sqlite3 "$ISOLATE_DB" 'PRAGMA integrity_check;' 2>&1 || true)"
    echo "  - stock-trading.db: $main_result"
    if [[ -f "$ISOLATE_BLIND_DB" ]]; then
      blind_result="$(sqlite3 "$ISOLATE_BLIND_DB" 'PRAGMA integrity_check;' 2>&1 || true)"
      echo "  - blind-training.db: $blind_result"
    fi
    local version
    version="$(sqlite3 "$ISOLATE_DB" 'PRAGMA user_version;' 2>&1 || echo unknown)"
    echo "  - stock-trading.db user_version: $version"
  else
    warn "sqlite3 CLI 不可用，跳过完整性检查（仅做文件存在性检查）"
  fi
}

cmd_rollback() {
  ensure_repo
  log "准备回退到 $MAIN_BRANCH..."

  local current_branch
  current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo detached)"

  if [[ "$current_branch" != "$BRANCH_NAME" ]]; then
    warn "当前不在 $BRANCH_NAME 分支（当前: $current_branch），不执行分支回退"
  else
    if ! git diff --quiet HEAD || ! git diff --cached --quiet HEAD; then
      err "$BRANCH_NAME 上有未提交修改。是否丢弃并回退？"
      read -r -p "  输入 yes 继续，其他任意键取消: " ans
      if [[ "$ans" != "yes" ]]; then
        err "已取消回退"
        exit 1
      fi
      git reset --hard HEAD
    fi
    git checkout "$MAIN_BRANCH"
    git branch -D "$BRANCH_NAME"
    log "分支 $BRANCH_NAME 已删除，已切回 $MAIN_BRANCH"
  fi

  if [[ -d "$ISOLATE_ROOT" ]]; then
    log "删除隔离数据目录: $ISOLATE_ROOT"
    rm -rf "$ISOLATE_ROOT"
  fi

  log ""
  log "✓ 回退完成。生产数据与代码分支均已恢复原始状态。"
}

cmd_help() {
  sed -n '2,17p' "$0"
}

case "${1:-help}" in
  start) cmd_start ;;
  dev) cmd_dev ;;
  status) cmd_status ;;
  reset) cmd_reset ;;
  verify) cmd_verify ;;
  rollback) cmd_rollback ;;
  help|-h|--help) cmd_help ;;
  *)
    err "未知子命令: $1"
    cmd_help
    exit 1
    ;;
esac
