#!/bin/bash
# ============================================================
# sunnydoc 一键部署 + 推送脚本
# 用法：./deploy.sh "commit 信息"
# 流程：本机文件 scp → 服务器 git commit/push → GitHub
# ============================================================
set -e

SERVER="root@180.184.86.246"
DEPLOY_DIR="/var/www/sunnydoc"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
MSG="${1:-chore: 更新 sunnydoc}"

cd "$LOCAL_DIR"

echo "==> [1/3] 上传文件到服务器临时目录..."
ssh -o StrictHostKeyChecking=no "$SERVER" "mkdir -p /tmp/sunnydoc_upload/mvp-ui"
scp -o StrictHostKeyChecking=no -q README.md .gitignore "$SERVER:/tmp/sunnydoc_upload/"
scp -o StrictHostKeyChecking=no -q mvp-ui/index.html "$SERVER:/tmp/sunnydoc_upload/mvp-ui/"

echo "==> [2/3] 放置文件 + git commit + push 到 GitHub..."
ssh -o StrictHostKeyChecking=no "$SERVER" "cd $DEPLOY_DIR && \
  cp /tmp/sunnydoc_upload/README.md /tmp/sunnydoc_upload/.gitignore . && \
  cp /tmp/sunnydoc_upload/mvp-ui/index.html mvp-ui/ && \
  git add -A && \
  git -c user.name='Feize' -c user.email='fei2210ze@163.com' commit -m \"$MSG\" && \
  GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=no' git push origin main"

echo "==> [3/3] 完成。访问：http://180.184.86.246:85"
