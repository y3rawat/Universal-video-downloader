# Cobalt Downloader

A simple, beautiful UI for downloading videos from YouTube, Twitter, Instagram, TikTok, and more.

## Features

- 🎬 Download videos from multiple platforms
- 📱 Responsive design
- 📋 Download history
- ⚡ Fast and lightweight

## Supported Platforms

- ▶️ YouTube
- 🐦 Twitter/X  
- 📸 Instagram
- 🎵 TikTok
- 🤖 Reddit
- 🎬 Vimeo
- And more!

## Setup

### 1. Install Dependencies

```bash
cd cobalt-downloader
npm install
```

### 2. Start Cobalt (Docker)

Make sure Cobalt is running locally:

```bash
# Start Colima (if on macOS)
colima start

# Set Docker socket
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"

# Run Cobalt
docker run -d -p 9000:9000 --name cobalt \
  -e API_URL="http://localhost:9000" \
  -e API_PORT="9000" \
  ghcr.io/imputnet/cobalt:latest
```

### 3. Start the UI

```bash
npm run dev
```

Open http://localhost:5174

## Deploying Cobalt to Render

### Step 1: Create render.yaml

Create `render.yaml` in the cobalt-downloader folder with Docker settings.

### Step 2: Deploy to Render

1. Go to https://render.com
2. Click "New" → "Web Service"
3. Connect your GitHub repo
4. Select "Docker" as the environment
5. Set environment variables:
   - `API_URL`: `https://your-service-name.onrender.com`
   - `API_PORT`: `9000`
6. Deploy!

### Step 3: Update Frontend

After deploying, update your `.env`:

```
VITE_COBALT_URL=https://your-cobalt-instance.onrender.com
```

## Tech Stack

- React + Vite
- Cobalt (self-hosted)
- CSS (no frameworks)
