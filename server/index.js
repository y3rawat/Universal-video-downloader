// Load environment variables (.env first, then .env.local which overrides)
require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });

const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3002;

// Cobalt API URL - use environment variable for production
const COBALT_API = process.env.COBALT_URL || 'https://mindstore-cobalt-api.onrender.com';

// Backend API URL - for uploading to Drive and updating Firebase
const BACKEND_API = process.env.BACKEND_URL || 'http://localhost:3000/api';

// YouTube cookies for bot detection bypass (from environment or local file)
let YOUTUBE_COOKIES = process.env.YOUTUBE_COOKIES || null;
if (!YOUTUBE_COOKIES && fs.existsSync(path.join(__dirname, 'cookies.txt'))) {
  try {
    YOUTUBE_COOKIES = fs.readFileSync(path.join(__dirname, 'cookies.txt'), 'utf8').trim();
  } catch (err) {
    console.log('Note: cookies.txt file not readable');
  }
}

// Platform cookies storage (fetched from Firebase via backend)
let platformCookies = {
  instagram: { cookies: null, syncedAt: null, expiresAt: null },
  twitter: { cookies: null, syncedAt: null, expiresAt: null },
  youtube: { cookies: null, syncedAt: null, expiresAt: null }
};

// Cookie expiration times (in days) - based on platform session lengths
const COOKIE_EXPIRY_DAYS = {
  instagram: 90,  // Instagram sessions typically last ~90 days
  twitter: 365,   // Twitter sessions last longer
  youtube: 180    // YouTube/Google sessions ~6 months
};

// Fetch cookies from backend (Firebase)
async function fetchCookiesFromBackend(platform) {
  try {
    const response = await fetch(`${BACKEND_API}/cookies/${platform}`);
    const data = await response.json();

    if (data.success && data.cookies) {
      platformCookies[platform] = {
        cookies: data.cookies,
        syncedAt: data.syncedAt,
        expiresAt: data.expiresAt
      };
      console.log(`🍪 Loaded ${platform} cookies from Firebase`);
      return data.cookies;
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch ${platform} cookies:`, error.message);
    return null;
  }
}

// Load all platform cookies from backend on startup
async function loadAllCookiesFromBackend() {
  console.log('📂 Loading cookies from Firebase...');
  for (const platform of ['instagram', 'twitter', 'youtube']) {
    await fetchCookiesFromBackend(platform);
  }
}

// Load cookies on startup (after a short delay to ensure server is ready)
setTimeout(loadAllCookiesFromBackend, 2000);

// Create a Netscape cookie file for yt-dlp from browser cookie string
function createCookieFile(platform, cookieString) {
  const cookieFilePath = path.join(TEMP_DIR, `${platform}_cookies.txt`);

  // Map platforms to their domains
  const domains = {
    instagram: '.instagram.com',
    twitter: '.twitter.com',
    youtube: '.youtube.com'
  };

  const domain = domains[platform] || `.${platform}.com`;

  // Parse cookie string (format: "name1=value1; name2=value2")
  const cookies = cookieString.split(';').map(c => c.trim()).filter(c => c);

  // Create Netscape cookie file format
  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.se/docs/http-cookies.html',
    ''
  ];

  cookies.forEach(cookie => {
    const [name, ...valueParts] = cookie.split('=');
    const value = valueParts.join('='); // Handle values with = in them
    if (name && value) {
      // Format: domain\tinclude_subdomains\tpath\tsecure\texpiry\tname\tvalue
      lines.push(`${domain}\tTRUE\t/\tTRUE\t${Math.floor(Date.now() / 1000) + 86400 * 365}\t${name.trim()}\t${value.trim()}`);
    }
  });

  fs.writeFileSync(cookieFilePath, lines.join('\n'));
  return cookieFilePath;
}

// CORS configuration - allow all origins for simplicity
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// Temp directory for downloads
const TEMP_DIR = process.env.TEMP_DIR || path.join(os.tmpdir(), 'cobalt-downloads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper to extract text from VTT/SRT subtitle files
function extractSubtitleText(subtitlePath) {
  try {
    if (!fs.existsSync(subtitlePath)) return null;

    const content = fs.readFileSync(subtitlePath, 'utf8');
    // Simple VTT/SRT cleanup: remove timestamps, headers, and metadata
    const lines = content.split('\n');
    const uniqueLines = new Set();

    lines.forEach(line => {
      line = line.trim();
      // Skip empty lines, headers, timestamp lines (00:00:00 --> 00:00:00), and numeric indices
      if (!line ||
        line.startsWith('WEBVTT') ||
        line.match(/^[0-9]+$/) ||
        line.match(/^[0-9]{2}:[0-9]{2}:[0-9]{2}/) ||
        line.startsWith('NOTE')) {
        return;
      }
      // Remove HTML tags like <b>, <i>, <c>
      const cleanLine = line.replace(/<[^>]*>/g, '');
      if (cleanLine) uniqueLines.add(cleanLine);
    });

    return Array.from(uniqueLines).join(' ');
  } catch (err) {
    console.error('Error extracting subtitle:', err.message);
    return null;
  }
}

/**
 * Upload downloaded file to Google Drive via backend API
 * Also updates Firebase with the Drive link and metadata
 * @param {string} filePath - Path to the downloaded file
 * @param {string} url - Original URL
 * @param {string} userId - User ID
 * @param {string} contentHash - Content hash for Firebase
 * @param {Object} metadata - Optional metadata (title, author, thumbnail, platform)
 * @param {string} transcript - Optional transcript text
 */
async function uploadToDriveViaBackend(filePath, url, userId, contentHash, metadata = {}, transcript = null) {
  const uploadStart = Date.now();

  if (!filePath || !fs.existsSync(filePath)) {
    console.log('⚠️ No file to upload');
    return { success: false, error: 'No file to upload' };
  }

  if (!userId || !contentHash) {
    console.log('⚠️ Missing userId or contentHash, skipping Drive upload');
    return { success: false, error: 'Missing userId or contentHash' };
  }

  try {
    console.log(`\n📤 ========== DRIVE UPLOAD START ==========`);
    console.log(`📁 File: ${filePath}`);

    if (metadata.title) {
      console.log(`📝 Including metadata: title="${metadata.title}", author="${metadata.author || 'unknown'}"`);
    }
    if (transcript) {
      console.log(`📝 Including transcript (${transcript.length} chars)`);
    }

    // Read file as base64
    const readStart = Date.now();
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const filename = path.basename(filePath);
    const fileSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`⏱️ [UPLOAD] File read + base64: ${Date.now() - readStart}ms (${fileSizeMB} MB)`);

    // Detect platform from URL
    const platform = metadata.platform || detectPlatformFromUrl(url);

    // Create abort controller with timeout for large file uploads
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minute timeout

    // Send to backend upload-to-drive endpoint with metadata
    const response = await fetch(`${BACKEND_API}/upload-to-drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        userId,
        contentHash,
        url,
        filename,
        mediaData: base64Data,
        mimeType: 'video/mp4',
        // Include metadata for Firestore
        platform,
        title: metadata.title || null,
        author: metadata.author || metadata.uploader || null,
        thumbnailUrl: metadata.thumbnail || metadata.thumbnailUrl || null,
        caption: metadata.description || metadata.caption || null,
        postUrl: url,
        transcript: transcript // Send transcript (native or null)
      })
    });

    clearTimeout(timeoutId);
    const apiTime = Date.now() - uploadStart;
    console.log(`⏱️ [UPLOAD] Backend API call: ${apiTime}ms`);

    // Check if response is ok before parsing JSON
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Backend returned ${response.status}: ${errorText.substring(0, 200)}`);
      return { success: false, error: `Backend error: ${response.status}` };
    }

    const data = await response.json();

    if (data.success) {
      const viewLink = data.driveFile?.webViewLink || data.viewLink;
      const fileId = data.driveFile?.id || data.fileId;
      const totalTime = Date.now() - uploadStart;
      console.log(`\n✅ ========== DRIVE UPLOAD COMPLETE ==========`);
      console.log(`🔗 Link: ${viewLink}`);
      console.log(`⏱️ Total upload time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
      console.log(`==============================================\n`);
      // Clean up local file after successful upload
      fs.unlinkSync(filePath);
      return {
        success: true,
        viewLink,
        fileId
      };
    } else {
      console.log(`❌ Drive upload failed: ${data.error}`);
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('❌ Error uploading to Drive:', error.message);
    return { success: false, error: error.message };
  }
}

// Helper to detect platform from URL
function detectPlatformFromUrl(url) {
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('linkedin.com')) return 'linkedin';
  return 'unknown';
}

// Check if video is private using yt-dlp
async function checkVideoStatus(url) {
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--skip-download',
      '--print', '%(availability)s',
      '--print', '%(title)s',
      '--no-warnings',
      url
    ]);

    let output = '';
    let errorOutput = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ytdlp.on('close', (code) => {
      const lines = output.trim().split('\n');
      const availability = lines[0] || '';
      const title = lines[1] || '';

      // Check for private/unavailable
      if (errorOutput.includes('Private video') ||
        errorOutput.includes('Sign in to confirm your age') ||
        errorOutput.includes('Video unavailable') ||
        availability === 'private' ||
        availability === 'needs_auth') {
        resolve({
          status: 'private',
          message: 'This video is private or requires authentication',
          title
        });
      } else if (errorOutput.includes('is not available') ||
        errorOutput.includes('Video unavailable') ||
        code !== 0) {
        // Check if it's a geo-restriction or other issue
        if (errorOutput.includes('not available in your country')) {
          resolve({ status: 'geo-blocked', message: 'Video not available in your region', title });
        } else if (errorOutput.includes('removed')) {
          resolve({ status: 'removed', message: 'Video has been removed', title });
        } else {
          resolve({ status: 'unavailable', message: 'Video is unavailable', title });
        }
      } else {
        resolve({ status: 'available', title });
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      ytdlp.kill();
      resolve({ status: 'unknown', message: 'Check timed out' });
    }, 10000);
  });
}

// Try to download with Cobalt - downloads to temp file first
async function downloadWithCobalt(url) {
  try {
    const response = await fetch(COBALT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.error?.code || 'Cobalt failed');
    }

    if (!data.url) {
      throw new Error('No download URL from Cobalt');
    }

    console.log(`Cobalt returned URL (status: ${data.status}), downloading to temp file...`);
    console.log(`Tunnel URL: ${data.url}`);

    // Download the file to temp directory
    const filename = (data.filename || `cobalt_${Date.now()}.mp4`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const outputPath = path.join(TEMP_DIR, filename);

    return new Promise((resolve) => {
      // Use curl with proper options for streaming download
      const curlArgs = [
        '-L',                    // Follow redirects
        '-f',                    // Fail on HTTP errors
        '-o', outputPath,        // Output file
        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        '--connect-timeout', '30', // Connection timeout
        '--max-time', '300',     // 5 minute total timeout
        '-#',                    // Progress bar
        data.url
      ];

      console.log(`Running: curl ${curlArgs.join(' ')}`);

      const curlProcess = spawn('curl', curlArgs);

      let stdoutData = '';
      let stderrData = '';

      curlProcess.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      curlProcess.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrData += text;
        process.stderr.write(text); // Show progress
      });

      curlProcess.on('error', (err) => {
        console.error(`curl spawn error: ${err.message}`);
        resolve({ success: false, error: `curl spawn error: ${err.message}` });
      });

      curlProcess.on('close', (code) => {
        console.log(`\ncurl exited with code: ${code}`);

        if (code !== 0) {
          console.error(`curl stderr: ${stderrData}`);
          resolve({ success: false, error: `curl failed (code ${code}): ${stderrData || 'unknown error'}` });
          return;
        }

        if (!fs.existsSync(outputPath)) {
          resolve({ success: false, error: 'Download completed but file not found' });
          return;
        }

        const stats = fs.statSync(outputPath);
        console.log(`Downloaded file size: ${stats.size} bytes`);

        // Validate file size
        if (stats.size === 0) {
          fs.unlinkSync(outputPath);
          resolve({ success: false, error: 'Downloaded 0 bytes from Cobalt' });
          return;
        }

        if (stats.size < 50000) { // Less than 50KB is suspicious for a video
          fs.unlinkSync(outputPath);
          resolve({ success: false, error: `Downloaded only ${stats.size} bytes - too small for a video` });
          return;
        }

        console.log(`✅ Cobalt download complete: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

        resolve({
          success: true,
          method: 'cobalt',
          filePath: outputPath,
          filename,
          size: stats.size
        });
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        curlProcess.kill();
        resolve({ success: false, error: 'Cobalt download timed out' });
      }, 300000);
    });

  } catch (error) {
    console.log('Cobalt failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Try to download with yt-dlp
async function downloadWithYtdlp(url) {
  return new Promise((resolve) => {
    const filename = `video_${Date.now()}.mp4`;
    const outputPath = path.join(TEMP_DIR, filename);
    const ytdlpStart = Date.now();

    console.log(`\n📥 ========== YT-DLP START ==========`);
    console.log(`📍 URL: ${url}`);
    console.log(`📁 Output: ${outputPath}`);

    // Detect platform to use appropriate cookies
    const isInstagram = url.includes('instagram.com');
    const isTwitter = url.includes('twitter.com') || url.includes('x.com');
    const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

    // Build yt-dlp arguments
    const ytdlpArgs = [];

    // For Instagram: prefer combined format (video+audio in single stream) to avoid merge issues
    if (isInstagram) {
      ytdlpArgs.push('-f', 'best[ext=mp4]/best');
    } else {
      // Prefer H.264 codec (avc1) which doesn't need re-encoding - much faster!
      // Fallback to best quality if H.264 not available
      ytdlpArgs.push('-f', 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
    }

    ytdlpArgs.push(
      '--merge-output-format', 'mp4',
      // Skip re-encoding for faster processing - most platforms already use H.264
      // Only remux streams into MP4 container without re-encoding (much faster!)
      '--postprocessor-args', 'ffmpeg:-c:v copy -c:a copy',
      '-o', outputPath,
      '--no-playlist',
      '--no-warnings',
      '--progress',
      '--write-info-json'  // Save metadata to JSON file for caption/thumbnail extraction
    );

    // Add platform-specific cookies if available and not expired
    let cookiesFile = null;
    const now = Date.now();

    if (isInstagram && platformCookies.instagram?.cookies) {
      const isExpired = platformCookies.instagram.expiresAt && now > platformCookies.instagram.expiresAt;
      if (!isExpired) {
        cookiesFile = createCookieFile('instagram', platformCookies.instagram.cookies);
        console.log('🍪 Using synced Instagram cookies');
      } else {
        console.log('⚠️ Instagram cookies expired, need re-sync');
      }
    } else if (isTwitter && platformCookies.twitter?.cookies) {
      const isExpired = platformCookies.twitter.expiresAt && now > platformCookies.twitter.expiresAt;
      if (!isExpired) {
        cookiesFile = createCookieFile('twitter', platformCookies.twitter.cookies);
        console.log('🍪 Using synced Twitter cookies');
      } else {
        console.log('⚠️ Twitter cookies expired, need re-sync');
      }
    } else if (isYoutube && platformCookies.youtube?.cookies) {
      const isExpired = platformCookies.youtube.expiresAt && now > platformCookies.youtube.expiresAt;
      if (!isExpired) {
        cookiesFile = createCookieFile('youtube', platformCookies.youtube.cookies);
        console.log('🍪 Using synced YouTube cookies');
      } else {
        console.log('⚠️ YouTube cookies expired, need re-sync');
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // Only try browser cookies in development (won't work in Docker)
      ytdlpArgs.push('--cookies-from-browser', 'chrome');
    }

    if (cookiesFile) {
      ytdlpArgs.push('--cookies', cookiesFile);
    }

    // Add URL at the end
    ytdlpArgs.push(url);

    const ytdlp = spawn('yt-dlp', ytdlpArgs);

    let errorOutput = '';

    ytdlp.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log('yt-dlp:', data.toString());
    });

    ytdlp.stdout.on('data', (data) => {
      console.log('yt-dlp:', data.toString());
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        // Check file size to prevent 0KB downloads
        const stats = fs.statSync(outputPath);
        const fileSizeKB = stats.size / 1024;

        if (stats.size === 0) {
          console.log('❌ Downloaded file is 0KB - deleting');
          fs.unlinkSync(outputPath);
          resolve({
            success: false,
            error: 'Downloaded file is empty (0KB)'
          });
          return;
        }

        if (fileSizeKB < 10) {
          console.log(`⚠️ Downloaded file is only ${fileSizeKB.toFixed(2)}KB - suspiciously small`);
          fs.unlinkSync(outputPath);
          resolve({
            success: false,
            error: `Downloaded file is too small (${fileSizeKB.toFixed(2)}KB) - likely corrupted`
          });
          return;
        }

        console.log(`✅ Downloaded ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);

        const ytdlpTime = Date.now() - ytdlpStart;
        console.log(`⏱️ [YT-DLP] Download completed in ${ytdlpTime}ms (${(ytdlpTime / 1000).toFixed(1)}s)`);

        // Read metadata from .info.json file (created by --write-info-json)
        // yt-dlp creates the JSON file based on the output template, not the final filename
        const baseOutputPath = outputPath.replace(/\.[^/.]+$/, ''); // Remove extension
        const possibleJsonPaths = [
          `${baseOutputPath}.info.json`,
          outputPath.replace('.mp4', '.info.json'),
          // yt-dlp might add format info to filename
          ...fs.readdirSync(TEMP_DIR)
            .filter(f => f.endsWith('.info.json') && f.includes('video_'))
            .map(f => path.join(TEMP_DIR, f))
        ];

        let videoMetadata = {};
        let jsonFound = false;

        for (const jsonPath of possibleJsonPaths) {
          if (fs.existsSync(jsonPath)) {
            try {
              const infoContent = fs.readFileSync(jsonPath, 'utf8');
              videoMetadata = JSON.parse(infoContent);
              console.log(`📝 Captured metadata from ${path.basename(jsonPath)}: title="${videoMetadata.title?.substring(0, 50)}", uploader="${videoMetadata.uploader}"`);
              // Clean up the JSON file
              fs.unlinkSync(jsonPath);
              jsonFound = true;
              break;
            } catch (e) {
              console.log(`⚠️ Failed to parse ${path.basename(jsonPath)}: ${e.message}`);
            }
          }
        }

        if (!jsonFound) {
          console.log(`⚠️ No .info.json file found for metadata extraction`);
        }

        resolve({
          success: true,
          method: 'yt-dlp',
          filePath: outputPath,
          filename,
          size: stats.size,
          // Include metadata from yt-dlp for backend to use
          title: videoMetadata.title || null,
          description: videoMetadata.description || null,
          uploader: videoMetadata.uploader || null,
          thumbnail: videoMetadata.thumbnail || null,
        });
      } else {
        // Check for specific errors and provide helpful messages
        let userFriendlyError = 'yt-dlp download failed';

        if (errorOutput.includes('Sign in to confirm')) {
          userFriendlyError = 'YouTube requires verification. Please try again with the browser extension.';
        } else if (errorOutput.includes('Forbidden')) {
          userFriendlyError = 'Access denied. The video might be age-restricted or region-locked. Please try again with the browser extension.';
        } else if (errorOutput.includes('Not available')) {
          userFriendlyError = 'Video is not available in this region or has been removed.';
        } else if (errorOutput.includes('Private video')) {
          userFriendlyError = 'This video is private and cannot be downloaded.';
        }

        resolve({
          success: false,
          error: userFriendlyError
        });
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      ytdlp.kill();
      resolve({ success: false, error: 'Download timed out' });
    }, 300000);
  });
}

// Get video info using yt-dlp
async function getVideoInfo(url) {
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--skip-download',
      '--print-json',
      '--no-warnings',
      url
    ]);

    let output = '';
    let errorOutput = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && output) {
        try {
          const info = JSON.parse(output);
          resolve({
            title: info.title,
            duration: info.duration,
            thumbnail: info.thumbnail,
            uploader: info.uploader,
            platform: info.extractor_key
          });
        } catch (e) {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    setTimeout(() => {
      ytdlp.kill();
      resolve(null);
    }, 15000);
  });
}

// API: Check video status
app.post('/api/check', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log('Checking video status:', url);
  const status = await checkVideoStatus(url);
  res.json(status);
});

// API: Get video info
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log('Getting video info:', url);
  const info = await getVideoInfo(url);

  if (info) {
    res.json(info);
  } else {
    res.status(404).json({ error: 'Could not get video info' });
  }
});

// API: Download video
app.post('/api/download', async (req, res) => {
  const { url, userId, contentHash, cookies } = req.body;
  const startTime = Date.now();
  const timings = {};

  const logStep = (step) => {
    const elapsed = Date.now() - startTime;
    timings[step] = elapsed;
    console.log(`⏱️ [COBALT] ${step}: ${elapsed}ms`);
  };

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`\n🎬 ========== COBALT DOWNLOAD START ==========`);
  console.log(`📍 URL: ${url}`);
  console.log(`👤 User: ${userId}`);
  console.log(`🔑 Hash: ${contentHash}`);

  // Detect platform
  const isInstagram = url.includes('instagram.com');
  const isTwitter = url.includes('twitter.com') || url.includes('x.com');
  logStep('1. Request parsed');

  // If cookies were passed in request, use them (from webapp via local backend)
  if (cookies) {
    const platform = isInstagram ? 'instagram' : isTwitter ? 'twitter' : null;
    if (platform) {
      console.log(`🍪 Using cookies from request for ${platform}`);
      platformCookies[platform] = {
        cookies: cookies,
        syncedAt: Date.now(),
        expiresAt: Date.now() + (90 * 24 * 60 * 60 * 1000) // 90 days
      };
    }
  }

  // Skip video status check for Instagram/Twitter (they require cookies)
  // Just try downloading directly
  let status = { status: 'available' };

  if (!isInstagram && !isTwitter) {
    // Only check status for YouTube and other platforms
    logStep('2. Checking video status');
    status = await checkVideoStatus(url);
    logStep('3. Status check done');

    if (status.status === 'private') {
      return res.json({
        success: false,
        status: 'private',
        message: '🔒 This video is private',
        requiresExtension: false
      });
    }

    if (status.status === 'geo-blocked') {
      return res.json({
        success: false,
        status: 'geo-blocked',
        message: '🌍 Video not available in your region',
        requiresExtension: true
      });
    }

    if (status.status === 'removed' || status.status === 'unavailable') {
      return res.json({
        success: false,
        status: status.status,
        message: `❌ ${status.message}`,
        requiresExtension: false
      });
    }
  } else {
    console.log(`⏭️ Skipping status check for ${isInstagram ? 'Instagram' : 'Twitter'} (requires cookies)`);
    logStep('2. Skipped status check');
    // Refresh cookies from Firebase before attempting download
    const platform = isInstagram ? 'instagram' : 'twitter';
    await fetchCookiesFromBackend(platform);
    logStep('3. Refreshed cookies from Firebase');
  }

  // For Instagram/Twitter with cookies, try yt-dlp first (Cobalt API doesn't have our cookies)
  if ((isInstagram && platformCookies.instagram?.cookies) || (isTwitter && platformCookies.twitter?.cookies)) {
    console.log('🍪 Using yt-dlp with cookies (Cobalt API lacks cookie access)...');
    logStep('4. Starting yt-dlp download');
    const ytdlpResult = await downloadWithYtdlp(url);
    logStep(`5. yt-dlp finished (success: ${ytdlpResult.success})`);

    if (ytdlpResult.success) {
      // Use metadata captured during download (already has cookies/auth)
      const videoInfo = {
        title: ytdlpResult.title,
        uploader: ytdlpResult.uploader,
        thumbnail: ytdlpResult.thumbnail,
        description: ytdlpResult.description
      };
      console.log(`📝 Using captured metadata: title="${videoInfo.title?.substring(0, 50)}", uploader="${videoInfo.uploader}"`);
      console.log(`📦 File size: ${(ytdlpResult.size / (1024 * 1024)).toFixed(2)} MB`);

      logStep('6. Starting Drive upload');
      const driveResult = await uploadToDriveViaBackend(ytdlpResult.filePath, url, userId, contentHash, videoInfo);
      logStep(`7. Drive upload finished (success: ${driveResult.success})`);

      const totalTime = Date.now() - startTime;
      console.log(`\n✅ ========== COBALT COMPLETE ==========`);
      console.log(`📊 Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
      console.log(`📊 Breakdown: ${JSON.stringify(timings)}`);
      console.log(`==========================================\n`);

      return res.json({
        success: true,
        method: 'yt-dlp',
        filename: ytdlpResult.filename,
        size: ytdlpResult.size,
        driveUploaded: driveResult.success,
        driveViewLink: driveResult.viewLink,
        driveFile: driveResult.success ? { id: driveResult.fileId, webViewLink: driveResult.viewLink } : null,
        // Include metadata so backend can use it
        metadata: {
          title: videoInfo.title || null,
          author: videoInfo.uploader || null,
          thumbnail: videoInfo.thumbnail || null,
          description: videoInfo.description || null
        },
        timings,
        message: `✅ Downloaded via yt-dlp with cookies (${(ytdlpResult.size / (1024 * 1024)).toFixed(2)} MB)${driveResult.success ? ' & uploaded to Drive!' : ''}`
      });
    }

    // yt-dlp failed even with cookies
    console.log('yt-dlp with cookies failed, trying Cobalt as fallback...');
  }

  // Try Cobalt (works better for YouTube and public content)
  console.log('Trying Cobalt...');
  const cobaltResult = await downloadWithCobalt(url);

  if (cobaltResult.success) {
    // For Cobalt: try to get metadata, but it may fail for Instagram
    console.log('📝 Fetching video metadata...');
    const videoInfo = await getVideoInfo(url) || {};
    // Upload to Google Drive via backend with metadata
    const driveResult = await uploadToDriveViaBackend(cobaltResult.filePath, url, userId, contentHash, videoInfo);

    return res.json({
      success: true,
      method: 'cobalt',
      filename: cobaltResult.filename,
      size: cobaltResult.size,
      driveUploaded: driveResult.success,
      driveViewLink: driveResult.viewLink,
      driveFile: driveResult.success ? { id: driveResult.fileId, webViewLink: driveResult.viewLink } : null,
      // Include metadata so backend can use it
      metadata: {
        title: videoInfo.title || null,
        author: videoInfo.uploader || null,
        thumbnail: videoInfo.thumbnail || null,
        description: videoInfo.description || null
      },
      message: `✅ Downloaded via Cobalt (${(cobaltResult.size / (1024 * 1024)).toFixed(2)} MB)${driveResult.success ? ' & uploaded to Drive!' : ''}`
    });
  }

  // Try yt-dlp as fallback
  console.log('Cobalt failed, trying yt-dlp...');
  const ytdlpResult = await downloadWithYtdlp(url);

  if (ytdlpResult.success) {
    // Use metadata captured during download
    const videoInfo = {
      title: ytdlpResult.title,
      uploader: ytdlpResult.uploader,
      thumbnail: ytdlpResult.thumbnail,
      description: ytdlpResult.description
    };
    console.log(`📝 Using captured metadata: title="${videoInfo.title?.substring(0, 50)}", uploader="${videoInfo.uploader}"`);
    const driveResult = await uploadToDriveViaBackend(ytdlpResult.filePath, url, userId, contentHash, videoInfo);

    return res.json({
      success: true,
      method: 'yt-dlp',
      filePath: ytdlpResult.filePath,
      filename: ytdlpResult.filename,
      size: ytdlpResult.size,
      driveUploaded: driveResult.success,
      driveViewLink: driveResult.viewLink,
      driveFile: driveResult.success ? { id: driveResult.fileId, webViewLink: driveResult.viewLink } : null,
      // Include metadata so backend can use it
      metadata: {
        title: videoInfo.title || null,
        author: videoInfo.uploader || null,
        thumbnail: videoInfo.thumbnail || null,
        description: videoInfo.description || null
      },
      message: `✅ Downloaded via yt-dlp (${(ytdlpResult.size / (1024 * 1024)).toFixed(2)} MB)${driveResult.success ? ' & uploaded to Drive!' : ''}`
    });
  }

  // Both failed - need extension or cookies
  console.log('Both methods failed, waiting for extension...');

  // Check if cookies are missing for the platform
  let cookieMessage = '';

  if (isInstagram && !platformCookies.instagram?.cookies) {
    cookieMessage = '🍪 Instagram cookies not synced! Open the extension on Instagram and click "Sync Cookies".';
  } else if (isTwitter && !platformCookies.twitter?.cookies) {
    cookieMessage = '🍪 Twitter cookies not synced!';
  }

  return res.json({
    success: false,
    status: 'needs-extension',
    message: cookieMessage || '⏳ Waiting for browser extension...',
    requiresExtension: true,
    needsCookies: !!cookieMessage,
    errors: {
      cobalt: cobaltResult.error,
      ytdlp: ytdlpResult.error
    }
  });
});

// API: Serve downloaded file
app.get('/api/file/:filename', (req, res) => {
  const filePath = path.join(TEMP_DIR, req.params.filename);

  if (fs.existsSync(filePath)) {
    // Check file size before serving
    const stats = fs.statSync(filePath);

    if (stats.size === 0) {
      console.log('❌ Attempted to serve 0KB file');
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'File is empty (0KB) - download failed' });
    }

    if (stats.size < 10 * 1024) { // Less than 10KB
      console.log(`⚠️ Attempted to serve suspiciously small file: ${stats.size} bytes`);
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'File is too small - likely corrupted' });
    }

    res.download(filePath, req.params.filename, (err) => {
      if (!err) {
        // Delete file after download
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }, 5000);
      }
    });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Helper to check if cookies are valid (exist and not expired)
function getCookieStatus(platform) {
  const data = platformCookies[platform];
  if (!data?.cookies) return { synced: false };

  const now = Date.now();
  const isExpired = data.expiresAt && now > data.expiresAt;
  const daysRemaining = data.expiresAt ? Math.ceil((data.expiresAt - now) / (1000 * 60 * 60 * 24)) : null;

  return {
    synced: true,
    expired: isExpired,
    syncedAt: data.syncedAt,
    expiresAt: data.expiresAt,
    daysRemaining: isExpired ? 0 : daysRemaining
  };
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    cobalt: COBALT_API,
    ytdlp: 'checking...',
    environment: process.env.NODE_ENV || 'development',
    cookies: {
      instagram: getCookieStatus('instagram'),
      twitter: getCookieStatus('twitter'),
      youtube: getCookieStatus('youtube')
    }
  });
});

// Receive cookies from browser extension
app.post('/api/cookies', (req, res) => {
  const { platform, cookies } = req.body;

  if (!platform || !cookies) {
    return res.status(400).json({
      success: false,
      message: 'Missing platform or cookies'
    });
  }

  const validPlatforms = ['instagram', 'twitter', 'youtube'];
  if (!validPlatforms.includes(platform.toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: `Invalid platform. Supported: ${validPlatforms.join(', ')}`
    });
  }

  // Store the cookies with timestamp and expiration
  const platformKey = platform.toLowerCase();
  const expiryDays = COOKIE_EXPIRY_DAYS[platformKey] || 90;
  const now = Date.now();

  platformCookies[platformKey] = {
    cookies: cookies,
    syncedAt: now,
    expiresAt: now + (expiryDays * 24 * 60 * 60 * 1000) // Convert days to ms
  };
  savePlatformCookies();

  console.log(`🍪 Received ${platform} cookies from extension (expires in ${expiryDays} days)`);

  res.json({
    success: true,
    message: `${platform} cookies synced successfully! Valid for ${expiryDays} days.`,
    platform: platformKey,
    expiresIn: `${expiryDays} days`,
    expiresAt: new Date(platformCookies[platformKey].expiresAt).toISOString()
  });
});

// Get cookie status with expiration info
app.get('/api/cookies/status', (req, res) => {
  res.json({
    success: true,
    cookies: {
      instagram: getCookieStatus('instagram'),
      twitter: getCookieStatus('twitter'),
      youtube: getCookieStatus('youtube')
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Cobalt Downloader API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      download: 'POST /api/download',
      info: 'POST /api/info',
      check: 'POST /api/check',
      cookies: 'POST /api/cookies',
      cookiesStatus: 'GET /api/cookies/status',
      file: 'GET /api/file/:filename'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Cobalt Downloader Server running on port ${PORT}`);
  console.log(`   Cobalt API: ${COBALT_API}`);
  console.log(`   Temp dir: ${TEMP_DIR}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
