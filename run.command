#!/bin/bash
# 运营双击运行入口（macOS）。会自动定位到脚本所在目录。

cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo "   Meta 游戏推送自动化"
echo "=============================================="
echo ""

# 1. 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "✖ 未检测到 Node.js，请先安装 Node 18+：https://nodejs.org/"
  echo ""
  read -r -p "按回车键退出..."
  exit 1
fi

# 2. 首次运行自动安装依赖
if [ ! -d node_modules ]; then
  echo "▶ 首次运行，正在安装依赖（约需几分钟，请耐心等待）..."
  npm install || { echo "✖ 依赖安装失败"; read -r -p "按回车键退出..."; exit 1; }
  npx playwright install chromium || { echo "✖ 浏览器内核安装失败"; read -r -p "按回车键退出..."; exit 1; }
  echo ""
fi

# 3. 检查 .env 配置
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠ 已为你生成配置文件 .env。"
  echo "  请先填写 ADSPOWER_USER_ID（AdsPower 环境编号）等信息，保存后再次双击运行本脚本。"
  open -e .env 2>/dev/null || true
  echo ""
  read -r -p "按回车键退出..."
  exit 1
fi

# 4. 提示当前将处理的 campaigns
echo "▶ 将处理 campaigns/ 目录下的推送配置..."
echo "  （每个游戏需要一对文件：<游戏>.csv 内容表 + <游戏>.schedule.csv 排期表）"
echo ""

# 5. 运行
npm start
code=$?

echo ""
echo "=============================================="
if [ "$code" -eq 0 ]; then
  echo "   ✔ 全部完成"
else
  echo "   ⚠ 运行结束，有部分失败（退出码 $code）"
  echo "     失败详情见上方日志，出错截图在 screenshots/ 目录。"
fi
echo "=============================================="
read -r -p "按回车键关闭窗口..."
