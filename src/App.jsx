import { useState, useEffect } from 'react'
import './App.css'

// Backend API URL - use environment variable or default to Render deployment
const API_URL = import.meta.env.VITE_API_URL || 'https://universal-video-downloader-2bv8.onrender.com'

function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [videoInfo, setVideoInfo] = useState(null)

  const detectPlatform = (url) => {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return { name: 'YouTube', icon: '▶️', color: '#ff0000' }
    if (url.includes('twitter.com') || url.includes('x.com')) return { name: 'Twitter/X', icon: '🐦', color: '#1da1f2' }
    if (url.includes('instagram.com')) return { name: 'Instagram', icon: '📸', color: '#e4405f' }
    if (url.includes('tiktok.com')) return { name: 'TikTok', icon: '🎵', color: '#000000' }
    if (url.includes('reddit.com')) return { name: 'Reddit', icon: '🤖', color: '#ff4500' }
    if (url.includes('vimeo.com')) return { name: 'Vimeo', icon: '🎬', color: '#1ab7ea' }
    return { name: 'Unknown', icon: '🔗', color: '#666' }
  }

  // Fetch video info when URL changes
  useEffect(() => {
    const fetchInfo = async () => {
      if (!url.trim() || !url.includes('http')) {
        setVideoInfo(null)
        return
      }

      try {
        const response = await fetch(`${API_URL}/api/info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() })
        })
        
        if (response.ok) {
          const info = await response.json()
          setVideoInfo(info)
        }
      } catch (e) {
        // Ignore info fetch errors
      }
    }

    const debounce = setTimeout(fetchInfo, 500)
    return () => clearTimeout(debounce)
  }, [url])

  const handleDownload = async (e) => {
    e.preventDefault()
    
    if (!url.trim()) {
      setError('Please enter a URL')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setLoadingStatus('🔍 Checking video...')

    try {
      setLoadingStatus('⚡ Trying Cobalt...')
      
      const response = await fetch(`${API_URL}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      })

      const data = await response.json()

      // Handle private videos
      if (data.status === 'private') {
        setResult({
          isPrivate: true,
          message: data.message,
          platform: detectPlatform(url)
        })
        return
      }

      // Handle geo-blocked
      if (data.status === 'geo-blocked') {
        setResult({
          isGeoBlocked: true,
          message: data.message,
          requiresExtension: true,
          platform: detectPlatform(url)
        })
        return
      }

      // Handle removed/unavailable
      if (data.status === 'removed' || data.status === 'unavailable') {
        setError(data.message)
        return
      }

      // Handle needs extension
      if (data.status === 'needs-extension') {
        setResult({
          requiresExtension: true,
          message: data.message,
          platform: detectPlatform(url),
          errors: data.errors
        })
        return
      }

      // Success!
      if (data.success) {
        let downloadUrl = data.downloadUrl
        
        // If downloaded via yt-dlp or cobalt (server-side), use our file endpoint
        if ((data.method === 'yt-dlp' || data.method === 'cobalt') && data.filename) {
          downloadUrl = `${API_URL}/api/file/${encodeURIComponent(data.filename)}`
        }

        // Format file size for display
        let sizeDisplay = null
        if (data.size) {
          const sizeMB = data.size / (1024 * 1024)
          sizeDisplay = sizeMB >= 1 ? `${sizeMB.toFixed(2)} MB` : `${(data.size / 1024).toFixed(2)} KB`
        }

        setResult({
          downloadUrl,
          filename: data.filename || 'video.mp4',
          platform: detectPlatform(url),
          method: data.method,
          message: data.message,
          size: sizeDisplay
        })

        // Add to history
        setHistory(prev => [{
          url: url.trim(),
          filename: data.filename,
          platform: detectPlatform(url),
          method: data.method,
          timestamp: new Date().toLocaleTimeString()
        }, ...prev.slice(0, 9)])
      } else {
        throw new Error(data.message || 'Download failed')
      }

    } catch (err) {
      console.error('Download error:', err)
      setError(err.message || 'Failed to get download link')
    } finally {
      setLoading(false)
      setLoadingStatus('')
    }
  }

  const handleDirectDownload = () => {
    if (result?.downloadUrl) {
      window.open(result.downloadUrl, '_blank')
    }
  }

  const clearHistory = () => {
    setHistory([])
  }

  return (
    <div className="app">
      <header className="header">
        <h1>⬇️ Cobalt Downloader</h1>
        <p>Download videos from YouTube, Twitter, Instagram, TikTok & more</p>
      </header>

      <main className="main">
        <form onSubmit={handleDownload} className="download-form">
          <div className="input-group">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste video URL here..."
              className="url-input"
              disabled={loading}
            />
            <button 
              type="submit" 
              className="download-btn"
              disabled={loading || !url.trim()}
            >
              {loading ? (
                <span className="spinner">⏳</span>
              ) : (
                '⬇️ Download'
              )}
            </button>
          </div>
        </form>

        {/* Video Info Preview */}
        {videoInfo && !loading && !result && (
          <div className="video-info-box">
            <div className="video-info-content">
              {videoInfo.thumbnail && (
                <img src={videoInfo.thumbnail} alt="" className="video-thumbnail" />
              )}
              <div className="video-details">
                <h4>{videoInfo.title}</h4>
                <p>{videoInfo.uploader}</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading Status */}
        {loading && loadingStatus && (
          <div className="loading-box">
            <span className="spinner-large">⏳</span>
            <p>{loadingStatus}</p>
          </div>
        )}

        {error && (
          <div className="error-box">
            <span>❌</span> {error}
          </div>
        )}

        {/* Private Video */}
        {result?.isPrivate && (
          <div className="private-box">
            <span className="private-icon">🔒</span>
            <h3>Private Video</h3>
            <p>This video is private and cannot be downloaded.</p>
            <span className="platform-tag" style={{ borderColor: result.platform.color }}>
              {result.platform.icon} {result.platform.name}
            </span>
          </div>
        )}

        {/* Geo-blocked Video */}
        {result?.isGeoBlocked && (
          <div className="geo-blocked-box">
            <span className="geo-icon">🌍</span>
            <h3>Region Restricted</h3>
            <p>This video is not available in your region.</p>
            <p className="extension-hint">Use the browser extension to download.</p>
          </div>
        )}

        {/* Needs Extension */}
        {result?.requiresExtension && !result.isPrivate && !result.isGeoBlocked && (
          <div className="extension-box">
            <span className="extension-icon">🧩</span>
            <h3>Extension Required</h3>
            <p>Automatic download failed. Please use the browser extension.</p>
            <div className="error-details">
              <p><strong>Cobalt:</strong> {result.errors?.cobalt || 'Failed'}</p>
              <p><strong>yt-dlp:</strong> {result.errors?.ytdlp || 'Failed'}</p>
            </div>
            <span className="platform-tag" style={{ borderColor: result.platform.color }}>
              {result.platform.icon} {result.platform.name}
            </span>
          </div>
        )}

        {/* Success Result */}
        {result && result.downloadUrl && !result.isPrivate && (
          <div className="result-box">
            <div className="result-header">
              <span style={{ color: result.platform.color }}>
                {result.platform.icon} {result.platform.name}
              </span>
              <span className="method-badge">{result.method}</span>
            </div>
            <p className="result-message">{result.message}</p>
            <p className="filename">{result.filename} {result.size && <span className="file-size">({result.size})</span>}</p>
            <button onClick={handleDirectDownload} className="save-btn">
              💾 Save Video
            </button>
          </div>
        )}

        <div className="supported-platforms">
          <h3>Supported Platforms</h3>
          <div className="platform-list">
            <span className="platform-badge youtube">▶️ YouTube</span>
            <span className="platform-badge twitter">🐦 Twitter/X</span>
            <span className="platform-badge instagram">📸 Instagram</span>
            <span className="platform-badge tiktok">🎵 TikTok</span>
            <span className="platform-badge reddit">🤖 Reddit</span>
            <span className="platform-badge vimeo">🎬 Vimeo</span>
          </div>
        </div>

        {history.length > 0 && (
          <div className="history-section">
            <div className="history-header">
              <h3>📋 Recent Downloads</h3>
              <button onClick={clearHistory} className="clear-btn">Clear</button>
            </div>
            <ul className="history-list">
              {history.map((item, index) => (
                <li key={index} className="history-item">
                  <span className="history-platform">{item.platform.icon}</span>
                  <span className="history-filename">{item.filename || 'Video'}</span>
                  <span className="history-method">{item.method}</span>
                  <span className="history-time">{item.timestamp}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Download Flow Info */}
        <div className="flow-info">
          <h3>📥 Download Flow</h3>
          <div className="flow-steps">
            <div className="flow-step">
              <span className="step-number">1</span>
              <span className="step-label">Cobalt API</span>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-step">
              <span className="step-number">2</span>
              <span className="step-label">yt-dlp</span>
            </div>
            <span className="flow-arrow">→</span>
            <div className="flow-step">
              <span className="step-number">3</span>
              <span className="step-label">Extension</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>Powered by <a href="https://github.com/imputnet/cobalt" target="_blank" rel="noopener">Cobalt</a> & <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener">yt-dlp</a></p>
        <p className="api-status">
          API: <code>{API_URL}</code>
        </p>
      </footer>
    </div>
  )
}

export default App
