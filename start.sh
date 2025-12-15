#!/bin/bash

# Cobalt Downloader - Start Script
# This script starts all required services

set -e

echo "🚀 Starting Cobalt Downloader..."
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if yt-dlp is installed
echo -e "\n${BLUE}[1/5] Checking yt-dlp...${NC}"
if command -v yt-dlp &> /dev/null; then
    echo -e "${GREEN}✓ yt-dlp is installed: $(yt-dlp --version)${NC}"
else
    echo -e "${YELLOW}⚠ yt-dlp not found. Installing...${NC}"
    if command -v brew &> /dev/null; then
        brew install yt-dlp
    elif command -v pip3 &> /dev/null; then
        pip3 install yt-dlp
    else
        echo -e "${RED}✗ Cannot install yt-dlp. Please install manually.${NC}"
        echo "  brew install yt-dlp  OR  pip3 install yt-dlp"
    fi
fi

# Check if Docker/Colima is running
echo -e "\n${BLUE}[2/5] Checking Docker...${NC}"
if command -v colima &> /dev/null; then
    if ! colima status 2>/dev/null | grep -q "Running"; then
        echo -e "${YELLOW}Starting Colima...${NC}"
        colima start
    fi
    export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
    echo -e "${GREEN}✓ Colima is running${NC}"
elif command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker is available${NC}"
else
    echo -e "${RED}✗ Docker not found. Please install Docker or Colima.${NC}"
    exit 1
fi

# Start Cobalt container
echo -e "\n${BLUE}[3/5] Starting Cobalt...${NC}"
if docker ps --format '{{.Names}}' | grep -q "^cobalt$"; then
    echo -e "${GREEN}✓ Cobalt is already running${NC}"
else
    if docker ps -a --format '{{.Names}}' | grep -q "^cobalt$"; then
        echo "Starting existing Cobalt container..."
        docker start cobalt
    else
        echo "Creating new Cobalt container..."
        docker run -d -p 9000:9000 --name cobalt \
            -e API_URL="http://localhost:9000" \
            -e API_PORT="9000" \
            ghcr.io/imputnet/cobalt:latest
    fi
    sleep 3
    echo -e "${GREEN}✓ Cobalt started on port 9000${NC}"
fi

# Install npm dependencies if needed
echo -e "\n${BLUE}[4/5] Checking dependencies...${NC}"
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Also check server dependencies
if [ ! -d "server/node_modules" ] && [ -d "server" ]; then
    echo "Installing server dependencies..."
    cd server && npm install && cd ..
fi
echo -e "${GREEN}✓ Dependencies ready${NC}"

# Start the backend server
echo -e "\n${BLUE}[5/5] Starting services...${NC}"

# Kill any existing processes on our ports
lsof -ti:5174 | xargs kill -9 2>/dev/null || true
lsof -ti:3002 | xargs kill -9 2>/dev/null || true

# Start backend server in background
echo "Starting backend server on port 3002..."
cd "$(dirname "$0")/server"
node index.js &
BACKEND_PID=$!
cd ..

sleep 2

# Start frontend
echo "Starting frontend on port 5174..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "================================"
echo -e "${GREEN}✓ All services started!${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC}  http://localhost:5174"
echo -e "  ${BLUE}Backend:${NC}   http://localhost:3002"
echo -e "  ${BLUE}Cobalt:${NC}    http://localhost:9000"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo "================================"

# Handle shutdown
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    echo -e "${GREEN}✓ All services stopped${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes
wait
