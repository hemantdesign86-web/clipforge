# ClipForge — Video Clipping Studio (MVP)

A self-hosted dark video clipping web app. It supports local video uploads, multiple manually selected clip ranges, a hard 90-second maximum per clip, center-cropped 9:16 conversion (1080×1920), individual MP4 downloads and ZIP batch export.

## Requirements
- Node.js 20+
- npm
- Internet connection for first dependency installation

## Run locally
```bash
npm install
npm start
```
Open http://localhost:3000

## How to use
1. Upload an MP4, MOV, WEBM, MKV or AVI file.
2. Add as many clip rows as needed.
3. Set each start and end time as `MM:SS` (or `HH:MM:SS`). Every clip must be 1–90 seconds and stay inside the source duration.
4. Export all clips. FFmpeg creates vertical 1080×1920 MP4s by scaling to fill and center-cropping.
5. Download clips individually or use Download ZIP.

## YouTube URL behavior / rights
The YouTube field embeds a privacy-enhanced preview only. It does not download a YouTube stream. YouTube Data API and OAuth do not grant a general right to download video bytes. For clipping, upload the original source file that you own or are authorized to use (for example, your creator master/export). Do not use this app to bypass platform restrictions or copy videos without permission.

## Production deployment checklist
This is a functional single-server MVP, not yet a hardened multi-user SaaS. Before public launch:
- Add authentication, per-user project ownership and authorization checks.
- Move uploads/exports to private object storage (S3/R2) and use signed URLs.
- Add a durable job queue (Redis + BullMQ), worker processes and job persistence.
- Add quotas, rate limits, upload scanning, CSRF protection and request validation.
- Configure HTTPS, reverse-proxy upload limits/timeouts, cleanup/retention policies and monitoring.
- Add user consent/rights confirmation and clear storage/deletion controls.
- For a multi-user production system, replace in-memory `videos` and `jobs` Maps with a database. They reset when the server restarts.

## Configuration
- `PORT` — server port (default 3000)
- Upload limit is 2 GB in `server.js`; tune it for your hosting and reverse proxy.
- Storage is under `storage/`; ensure sufficient disk space and backups/retention policy.


## Reel duration presets and auto-splitting

Choose 15, 30 or 90 seconds in the editor, then select **Auto-create reels** to split the entire uploaded source video into sequential clips of that duration. The final reel may be shorter if the source duration is not an exact multiple. Review, rename or remove generated clips before exporting. Manual clips may be up to 90 seconds.
