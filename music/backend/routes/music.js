const express = require('express');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const router = express.Router();

// Extract video ID from YouTube URL
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];

  for (let pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

// Get video info
async function getVideoInfo(videoId) {
  try {
    const info = await ytdl.getInfo(videoId);
    return {
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
      duration: parseInt(info.videoDetails.lengthSeconds),
      videoId: videoId
    };
  } catch (error) {
    console.log('Error getting video info:', error.message);
    return {
      title: 'Unknown Title',
      thumbnail: 'default.png',
      duration: 0,
      videoId: videoId
    };
  }
}

// Extract endpoint - get video info
router.post('/extract', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'YouTube URL required' });
  }

  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Check if video is downloadable
    try {
      const info = await ytdl.getInfo(videoId);
      if (info.videoDetails.isLiveContent) {
        return res.status(400).json({ error: 'Cannot download live streams' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Video unavailable or private' });
    }

    const videoInfo = await getVideoInfo(videoId);
    res.json({
      success: true,
      ...videoInfo
    });

  } catch (error) {
    console.error('Extract error:', error.message);
    res.status(500).json({ error: 'Failed to extract video info' });
  }
});

// Download endpoint - stream audio as MP3
router.get('/download', async (req, res) => {
  const { videoId, title } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID required' });
  }

  try {
    // Get the video stream
    const stream = ytdl(videoId, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    // Set response headers
    const fileName = sanitizeFilename(title || 'audio') + '.mp3';
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Convert to MP3 using FFmpeg
    ffmpeg(stream)
      .audioBitrate(128)
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('error', (error) => {
        console.error('FFmpeg error:', error.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to convert audio' });
        }
      })
      .pipe(res);

  } catch (error) {
    console.error('Download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download audio' });
    }
  }
});

// Stream endpoint - for playing audio
router.get('/stream', async (req, res) => {
  const { videoId } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: 'Video ID required' });
  }

  try {
    const stream = ytdl(videoId, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    stream.pipe(res);

  } catch (error) {
    console.error('Stream error:', error.message);
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});

// Sanitize filename
function sanitizeFilename(filename) {
  return filename.replace(/[^a-z0-9_-]/gi, '_').slice(0, 100);
}

module.exports = router;