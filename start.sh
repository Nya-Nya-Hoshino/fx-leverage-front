#!/usr/bin/env sh
# 一键启动（macOS / Linux / Git Bash）
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "未找到 Node.js（已在 v26.13 验证）"; exit 1; }
[ -d node_modules ] || npm install || exit 1
[ -f dist/index.html ] || npm run build || exit 1
echo "启动服务: http://127.0.0.1:8787"
( sleep 2; (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8787) || (command -v open >/dev/null && open http://127.0.0.1:8787) ) >/dev/null 2>&1 &
exec npm start
