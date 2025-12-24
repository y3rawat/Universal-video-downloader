# Custom Cobalt Dockerfile with Firebase Cookie Sync
# Fetches cookies from backend before starting Cobalt

FROM ghcr.io/imputnet/cobalt:latest

# Install curl for fetching cookies
USER root
RUN apk add --no-cache curl

# Copy the fetch script
COPY fetch-cookies.sh /fetch-cookies.sh
RUN chmod +x /fetch-cookies.sh

# Copy entrypoint wrapper
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch back to non-root user
USER 1000

# Set environment variables
ENV COOKIE_PATH=/cookies.json
ENV BACKEND_URL=https://mindstore-backend.onrender.com/api

# Use our custom entrypoint
ENTRYPOINT ["/entrypoint.sh"]
