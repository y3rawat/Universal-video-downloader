#!/bin/sh
# entrypoint.sh - Custom entrypoint for Cobalt with Firebase cookie sync

echo "🚀 MindStore Cobalt Starting..."
echo "📡 Backend URL: $BACKEND_URL"

# Fetch cookies from Firebase
/fetch-cookies.sh

# Check if cookies.json was created
if [ -f /cookies.json ]; then
  echo "✅ Cookies file ready"
  cat /cookies.json | head -c 200
  echo "..."
else
  echo "⚠️ No cookies.json created (will work without auth for some videos)"
fi

# Start the original Cobalt entrypoint
echo "🎬 Starting Cobalt..."
exec /app/docker-entrypoint.sh
