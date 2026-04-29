#!/bin/bash

# 大A盯盘终端 - 一键启动脚本

# 1. 进入目录并清理旧进程
echo "正在清理旧进程..."
lsof -t -i:8000 | xargs kill -9 2>/dev/null
lsof -t -i:5173 | xargs kill -9 2>/dev/null

# 2. 启动后端 (Python FastAPI)
echo "正在启动后端行情引擎 (Port 8000)..."
cd backend
source venv/bin/activate
nohup python main.py > backend.log 2>&1 &
cd ..

# 3. 启动前端 (React Vite)
echo "正在启动前端交互界面 (Port 5173)..."
cd frontend
nohup npm run dev > frontend.log 2>&1 &
cd ..

echo "---------------------------------------"
echo "✅ 服务启动成功！"
echo "👉 请访问: http://localhost:5173"
echo "📝 查看后端日志: tail -f backend/backend.log"
echo "📝 查看前端日志: tail -f frontend/frontend.log"
echo "---------------------------------------"
