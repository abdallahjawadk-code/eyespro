import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';

function mediaDir(): string {
  const dir = path.join(app.getPath('userData'), 'media');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listMedia(limit = 100) {
  return getDb().prepare(`SELECT * FROM media_files ORDER BY created_at DESC LIMIT ?`).all(limit);
}

export function importMediaFile(sourcePath: string, altText?: string): number {
  const name = path.basename(sourcePath);
  const time = Date.now();
  const dest = path.join(mediaDir(), `${time}_${name}`);
  fs.copyFileSync(sourcePath, dest);
  const st = fs.statSync(dest);
  
  let thumbnailPath: string | null = null;
  const ext = path.extname(sourcePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
    try {
      const thumbsDir = path.join(mediaDir(), 'thumbnails');
      if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
      
      const img = nativeImage.createFromPath(dest);
      if (!img.isEmpty()) {
        const thumb = img.resize({ width: 300, height: 300, quality: 'good' });
        const thumbDest = path.join(thumbsDir, `thumb_${time}_${name}`);
        let buf: Buffer;
        if (ext === '.png') buf = thumb.toPNG();
        else buf = thumb.toJPEG(80);
        fs.writeFileSync(thumbDest, buf);
        thumbnailPath = thumbDest;
      }
    } catch {
      /* ignore */
    }
  }

  const r = getDb()
    .prepare(`INSERT INTO media_files (filename, filepath, mime_type, size_bytes, alt_text, thumbnail_path) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(name, dest, '', st.size, altText ?? null, thumbnailPath);
  return Number(r.lastInsertRowid);
}

export function deleteMedia(id: number): boolean {
  const row = getDb().prepare(`SELECT filepath, thumbnail_path FROM media_files WHERE id=?`).get(id) as
    | { filepath: string; thumbnail_path: string | null }
    | undefined;
  if (!row) return false;
  try {
    fs.unlinkSync(row.filepath);
  } catch {
    /* ignore */
  }
  if (row.thumbnail_path) {
    try {
      fs.unlinkSync(row.thumbnail_path);
    } catch {
      /* ignore */
    }
  }
  getDb().prepare(`DELETE FROM media_files WHERE id=?`).run(id);
  return true;
}

export function mediaStats() {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes),0) AS bytes FROM media_files`)
    .get() as { count: number; bytes: number };
  return row;
}

export function updateMediaMeta(id: number, altText: string): boolean {
  return (
    getDb()
      .prepare(`UPDATE media_files SET alt_text=? WHERE id=?`)
      .run(sanitizeString(altText, 500), id).changes > 0
  );
}

export function getMediaPath(id: number): string | null {
  const row = getDb().prepare(`SELECT filepath FROM media_files WHERE id=?`).get(id) as
    | { filepath: string }
    | undefined;
  return row?.filepath ?? null;
}
