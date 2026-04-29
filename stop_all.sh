#!/bin/bash

echo "Stopping backend service on port 8000..."
lsof -t -i:8000 | xargs kill -9 2>/dev/null || echo "No process running on port 8000."

echo "Stopping frontend service on port 5173..."
lsof -t -i:5173 | xargs kill -9 2>/dev/null || echo "No process running on port 5173."

echo "All services stopped."
