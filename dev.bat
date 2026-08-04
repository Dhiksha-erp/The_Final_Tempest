#!/bin/bash

# Clean up processes on exit (when you press Ctrl+C)
trap 'kill %1; kill %2' SIGINT

echo "==========================================="
echo " Starting The Final Tempest Dev Servers..."
echo "==========================================="

echo "[1/2] Starting Python Backend..."
cd backend
source venv/bin/activate
uvicorn main:app --reload &

echo "[2/2] Starting React Frontend..."
cd ../frontend
npm run dev &

echo "==========================================="
echo " Both servers are running!"
echo " Backend API: http://localhost:8000"
echo " Dashboard:   http://localhost:5173"
echo " Press Ctrl+C to stop both servers."
echo "==========================================="

# Keep script running and wait for background jobs
wait
