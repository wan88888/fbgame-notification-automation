#!/usr/bin/env bash
# 把 quick tunnel 的公网地址写到 .ops-console/tunnel-url.txt；
# 与上次通知过的地址不同时，再推一条飞书。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.ops-console/tunnel-url.txt"
LAST="$ROOT/.ops-console/tunnel-url-notified.txt"
mkdir -p "$ROOT/.ops-console"
: >"$OUT"

CLOUDFLARED="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
NODE_BIN="${NODE_BIN:-$HOME/.nvm/versions/node/v24.18.0/bin}"
export PATH="$NODE_BIN:$HOME/.local/bin:$PATH"

notify_if_changed() {
  local url="$1"
  local prev=""
  if [[ -f "$LAST" ]]; then
    prev="$(tr -d '[:space:]' <"$LAST" || true)"
  fi
  if [[ "$url" == "$prev" ]]; then
    return 0
  fi
  # 通知失败不影响隧道本身
  (cd "$ROOT" && npx --yes tsx scripts/notify-tunnel-url.ts "$url") || true
  printf '%s\n' "$url" >"$LAST"
}

"$CLOUDFLARED" tunnel --no-autoupdate --url http://127.0.0.1:5173 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  if [[ "$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
    printf '%s\n' "${BASH_REMATCH[0]}" >"$OUT"
    notify_if_changed "${BASH_REMATCH[0]}"
  fi
done
exit "${PIPESTATUS[0]}"
