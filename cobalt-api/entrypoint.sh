#!/bin/sh
# entrypoint.sh - Custom entrypoint for Cobalt with Firebase cookie sync

echo "🚀 MindStore Cobalt Starting..."
echo "📡 Backend URL: $BACKEND_URL"

# Fetch cookies from Firebase
/fetch-cookies.sh

# Check if cookies file was created
COOKIE_FILE="${COOKIE_PATH:-/app/cookies/cookies.json}"
if [ -f "$COOKIE_FILE" ]; then
  echo "✅ Cookies file ready at $COOKIE_FILE"
  echo "📄 Cookie file size: $(wc -c < "$COOKIE_FILE") bytes"
else
  echo "⚠️ No cookies file created (will work without auth for some videos)"
fi

# Start Cobalt - run the Node.js app directly
echo "🎬 Starting Cobalt..."
cd /app && exec node src/cobalt.js
