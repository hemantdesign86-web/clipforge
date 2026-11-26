const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nanoid = (size = 21) => crypto.randomBytes(Math.ceil(size * 3 / 4)).toString('base64url').slice(0, size);

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, 'storage', 'uploads');
const EXPORTS = path.join(ROOT, 'storage', 'exports');
for (const dir of [UPLOADS, EXPORTS]) fs.mkdirSync(dir, { recursive: true });
ffmpeg.setFfmpegPath(ffmpegPath);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/media', express.static(UPLOADS));
app.use('/exports', express.static(EXPORTS));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => cb(null, `${nanoid()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 }, fileFilter: (_, file, cb) => {
  const ok = /^video\/(mp4|quicktime|webm|x-matroska|x-msvideo)$/i.test(file.mimetype) || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.originalname);
  cb(ok ? null : new Error('Please upload a supported video (MP4, MOV, WEBM, MKV or AVI).'), ok);
}});

const videos = new Map();
const jobs = new Map();
const safeName = s => String(s || 'clip').replace(/[^a-z0-9-_]/gi, '_').slice(0, 60);
const probe = file => new Promise((resolve, reject) => ffmpeg.ffprobe(file, (err, data) => err ? reject(err) : resolve(data)));

app.post('/api/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a video file first.' });
  try {
    const meta = await probe(req.file.path);
    const stream = meta.streams.find(s => s.codec_type === 'video');
    const duration = Number(meta.format.duration || 0);
    const item = { id: path.basename(req.file.filename, path.extname(req.file.filename)), filename: req.file.originalname, disk: req.file.path, url: `/media/${req.file.filename}`, duration, width: stream?.width || 0, height: stream?.height || 0 };
    videos.set(item.id, item);
    res.json({ video: { ...item, disk: undefined } });
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    res.status(422).json({ error: 'Could not read this video. Try an MP4 or MOV file.' });
  }
});

app.post('/api/clips', async (req, res) => {
  const { videoId, clips } = req.body || {};
  const video = videos.get(videoId);
  if (!video) return res.status(404).json({ error: 'Video not found. Upload it again.' });
  if (!Array.isArray(clips) || !clips.length || clips.length > 100) return res.status(400).json({ error: 'Add between 1 and 100 clips.' });
  for (const c of clips) {
    const start = Number(c.start), end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 90.001 || end > video.duration + 0.25) {
      return res.status(400).json({ error: `Invalid range for ${c.name || 'clip'}. Each clip must be 1–90 seconds and within the source video.` });
    }
  }
  const jobId = nanoid();
  jobs.set(jobId, { status: 'processing', clips: [], error: null });
  res.json({ jobId, status: 'processing' });
  (async () => {
    const job = jobs.get(jobId);
    try {
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        const id = nanoid(8);
        const output = path.join(EXPORTS, `${jobId}-${String(i + 1).padStart(2, '0')}-${safeName(c.name)}.mp4`);
        const start = Number(c.start), duration = Number(c.end) - start;
        await new Promise((resolve, reject) => {
          let command = ffmpeg(video.disk).setStartTime(start).duration(duration).videoCodec('libx264').audioCodec('aac').outputOptions(['-preset veryfast', '-crf 23', '-movflags +faststart']);
          // Reframe to 9:16 by scaling to fill then center-cropping. The source remains untouched.
          if (c.vertical !== false) command = command.videoFilters("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
          command.output(output).on('end', resolve).on('error', reject).run();
        });
        job.clips.push({ id, name: c.name || `Clip ${i + 1}`, start, end: Number(c.end), duration, url: `/exports/${path.basename(output)}`, filename: path.basename(output) });
      }
      job.status = 'completed';
    } catch (e) { job.status = 'failed'; job.error = e.message || 'Video processing failed.'; }
  })();
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found.' });
  res.json(job);
});

app.get('/api/jobs/:id/download-all', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'completed') return res.status(409).json({ error: 'Clips are not ready yet.' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="clipforge-${req.params.id}.zip"`);
  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', err => res.status(500).end(err.message));
  archive.pipe(res);
  for (const clip of job.clips) archive.file(path.join(EXPORTS, clip.filename), { name: clip.filename });
  archive.finalize();
});

// YouTube links are accepted for reference/preview only. YouTube Data/API access does not grant a downloadable media file.
app.post('/api/youtube-preview', (req, res) => {
  const raw = String(req.body?.url || '').trim();
  let parsed;
  try { parsed = new URL(raw); } catch { return res.status(400).json({ error: 'Enter a valid YouTube URL.' }); }
  let id = parsed.hostname.includes('youtu.be') ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
  if (!id && parsed.pathname.startsWith('/shorts/')) id = parsed.pathname.split('/')[2];
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '') || !['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be'].includes(parsed.hostname)) return res.status(400).json({ error: 'That does not look like a valid YouTube video URL.' });
  res.json({ videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, message: 'Preview only. To clip it, upload the original video file that you own or are authorized to use.' });
});

app.use((err, req, res, next) => res.status(400).json({ error: err.message || 'Request failed.' }));
app.listen(PORT, () => console.log(`ClipForge running at http://localhost:${PORT}`));
