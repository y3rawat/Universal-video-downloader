#!/bin/sh
# fetch-cookies.sh - Fetches cookies from Firebase backend and saves them for Cobalt

BACKEND_URL="${BACKEND_URL:-https://mindstore-backend.onrender.com/api}"

echo "🍪 Fetching cookies from Firebase backend..."

# Fetch cookies for each platform
fetch_platform_cookies() {
  PLATFORM=$1
  echo "📥 Fetching $PLATFORM cookies..."
  
  RESPONSE=$(curl -sf "$BACKEND_URL/cookies/$PLATFORM" 2>/dev/null)
  
  if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    # Check if cookies exist in response
    SUCCESS=$(echo "$RESPONSE" | grep -o '"success":true')
    if [ -n "$SUCCESS" ]; then
      echo "✅ $PLATFORM cookies found"
      echo "$RESPONSE"
      return 0
    fi
  fi
  
  echo "⚠️ No $PLATFORM cookies available"
  return 1
}

# Build cookies.json for Cobalt
build_cookies_json() {
  echo "📝 Building cookies.json..."
  
  COOKIES_JSON='{'
  FIRST=true
  
  for PLATFORM in youtube instagram twitter; do
    RESPONSE=$(curl -sf "$BACKEND_URL/cookies/$PLATFORM" 2>/dev/null)
    
    if [ $? -eq 0 ]; then
      SUCCESS=$(echo "$RESPONSE" | grep -o '"success":true')
      if [ -n "$SUCCESS" ]; then
        # Extract cookie string
        COOKIE_STRING=$(echo "$RESPONSE" | sed -n 's/.*"cookies":"\([^"]*\)".*/\1/p')
        
        if [ -n "$COOKIE_STRING" ]; then
          if [ "$FIRST" = false ]; then
            COOKIES_JSON="${COOKIES_JSON},"
          fi
          FIRST=false
          
          # Convert cookie string to Cobalt format (array of objects)
          # Format: name=value; name2=value2 -> [{"name":"name","value":"value","domain":".domain.com"}]
          DOMAIN=".${PLATFORM}.com"
          if [ "$PLATFORM" = "youtube" ]; then
            DOMAIN=".youtube.com"
          fi
          
          COOKIE_ARRAY='['
          FIRST_COOKIE=true
          
          # Split by semicolon and process each cookie
          echo "$COOKIE_STRING" | tr ';' '\n' | while read COOKIE; do
            COOKIE=$(echo "$COOKIE" | sed 's/^ *//' | sed 's/ *$//')
            if [ -n "$COOKIE" ]; then
              NAME=$(echo "$COOKIE" | cut -d= -f1)
              VALUE=$(echo "$COOKIE" | cut -d= -f2-)
              
              if [ "$FIRST_COOKIE" = false ]; then
                printf ','
              fi
              FIRST_COOKIE=false
              printf '{"name":"%s","value":"%s","domain":"%s"}' "$NAME" "$VALUE" "$DOMAIN"
            fi
          done
          
          COOKIE_ARRAY="${COOKIE_ARRAY}]"
          COOKIES_JSON="${COOKIES_JSON}\"${PLATFORM}\":${COOKIE_ARRAY}"
          
          echo "✅ Added $PLATFORM cookies"
        fi
      fi
    fi
  done
  
  COOKIES_JSON="${COOKIES_JSON}}"
  
  echo "$COOKIES_JSON" > /cookies.json
  echo "💾 Saved cookies to /cookies.json"
}

# Main
echo "🚀 Starting cookie sync..."
echo "📡 Backend URL: $BACKEND_URL"

# Build and save cookies
build_cookies_json

echo "✅ Cookie sync complete!"
