#!/bin/bash

# Cobalt Downloader - Stop Script
# This script stops all running services

echo "🛑 Stopping Cobalt Downloader..."
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Kill processes on specific ports
kill_on_port() {
    local port=$1
    local name=$2
    local pid=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}Stopping $name on port $port (PID: $pid)...${NC}"
        kill $pid 2>/dev/null
        sleep 0.5
        # Force kill if still running
        if ps -p $pid > /dev/null 2>&1; then
            kill -9 $pid 2>/dev/null
        fi
        echo -e "${GREEN}✓ $name stopped${NC}"
    else
        echo -e "${YELLOW}⚠ No process found on port $port${NC}"
    fi
}

echo ""
echo -e "${BLUE}[1/2] Stopping services...${NC}"
kill_on_port 5174 "Frontend"
kill_on_port 3002 "Backend"

echo ""
echo -e "${BLUE}[2/2] Cobalt Docker container...${NC}"
if docker ps --format '{{.Names}}' | grep -q "^cobalt$"; then
    echo -e "${YELLOW}Cobalt container is still running${NC}"
    echo -e "${YELLOW}To stop it, run: ${BLUE}docker stop cobalt${NC}"
else
    echo -e "${GREEN}✓ Cobalt container is not running${NC}"
fi

echo ""
echo "================================"
echo -e "${GREEN}✓ Cobalt Downloader services stopped!${NC}"
echo "================================"
