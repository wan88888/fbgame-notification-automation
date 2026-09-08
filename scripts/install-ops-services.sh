#!/usr/bin/env bash
# 把运营控制台做成用户级 systemd 服务：关掉 Cursor 后仍继续跑。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
chmod +x "$ROOT/scripts/ops-tunnel.sh"

cp "$ROOT/scripts/systemd/fbgame-ops-api.service" "$UNIT_DIR/"
cp "$ROOT/scripts/systemd/fbgame-ops-web.service" "$UNIT_DIR/"
cp "$ROOT/scripts/systemd/fbgame-ops-tunnel.service" "$UNIT_DIR/"

systemctl --user daemon-reload
systemctl --user enable fbgame-ops-api.service fbgame-ops-web.service fbgame-ops-tunnel.service

if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q Linger=yes; then
  echo "linger 已开启（注销后服务仍会跑）。"
else
  echo "正在尝试开启 linger（注销/关 Cursor 后服务不退出）..."
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "linger 已开启。"
  else
    echo "需要管理员执行一次：sudo loginctl enable-linger $USER"
  fi
fi

echo "已启用用户服务。启动：systemctl --user start fbgame-ops-api fbgame-ops-web fbgame-ops-tunnel"
echo "隧道地址：cat $ROOT/.ops-console/tunnel-url.txt"
echo "状态：systemctl --user status fbgame-ops-api fbgame-ops-web fbgame-ops-tunnel"
