/**
 * Pure decision engine for in-app video playback. Given a probe + file extension,
 * decides whether the file can be played directly by Chromium's <video> element,
 * or must be remuxed (fast container rewrap) / transcoded (full re-encode) to a
 * browser-friendly form. No I/O — fully unit-tested.
 *
 * Browser (Chromium/Electron) natively decodes: H.264, VP8/9, AV1, Theora video;
 * AAC, MP3, Opus, Vorbis, FLAC, PCM audio; in MP4/WebM/Ogg containers.
 * Everything else (HEVC/H.265, MPEG-2/4, VC-1, WMV, ProRes, MKV/AVI/MOV/FLV/TS
 * containers, AC-3/DTS/WMA audio) is handled by ffmpeg.
 */

export interface PlaybackProbe {
  hasVideo: boolean;
  videoCodec?: string;   // e.g. 'h264', 'hevc', 'vp9', 'av1', 'mpeg4'
  audioCodec?: string;   // e.g. 'aac', 'opus', 'ac3', 'mp3'
}

export type PlaybackMode = 'native' | 'remux' | 'transcode';

export interface PlaybackPlan {
  mode: PlaybackMode;
  /** Output container extension (without dot) when remux/transcode; '' for native. */
  outExt: string;
  /** ffmpeg arguments AFTER `-i <input>` and BEFORE `<output>`; empty for native. */
  ffmpegArgs: string[];
}

const norm = (s?: string) => (s ?? '').toLowerCase().trim();

// Conservative: only codecs Electron's bundled Chromium reliably decodes. AV1 and
// Theora are intentionally excluded — many Electron builds lack the AV1 decoder, so
// AV1 files (common from social downloads) must be transcoded to play reliably.
const NATIVE_VCODECS = new Set(['h264', 'avc1', 'vp8', 'vp9']);
const NATIVE_ACODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le']);
const NATIVE_VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'ogv', 'ogg']);
const NATIVE_AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'opus', 'oga', 'ogg']);
/** Video codecs the browser reliably decodes AND that fit cleanly in an MP4 (fast remux). */
const REMUX_MP4_VCODECS = new Set(['h264', 'avc1']);
/** Audio codecs valid to copy into an MP4 without re-encoding. */
const MP4_AUDIO_COPY_OK = new Set(['aac', 'mp3', 'ac3', 'eac3']);

/** Lowercase extension without the dot. */
export function extOf(filePath: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filePath);
  return m ? m[1]!.toLowerCase() : '';
}

/** True if a file with this extension + codecs plays directly in <video>. */
export function isBrowserPlayable(ext: string, p: PlaybackProbe): boolean {
  const e = norm(ext);
  const aOk = !p.audioCodec || NATIVE_ACODECS.has(norm(p.audioCodec));
  if (!p.hasVideo) {
    return NATIVE_AUDIO_EXT.has(e) && aOk;
  }
  const vOk = !p.videoCodec || NATIVE_VCODECS.has(norm(p.videoCodec));
  return NATIVE_VIDEO_EXT.has(e) && vOk && aOk;
}

/**
 * Decide how to make a file playable. Native → serve as-is. remux → rewrap into MP4
 * keeping the (browser-decodable) video stream, only re-encoding audio if needed.
 * transcode → full H.264/AAC re-encode (universal fallback).
 */
export function decidePlayback(filePath: string, p: PlaybackProbe): PlaybackPlan {
  const ext = extOf(filePath);

  if (isBrowserPlayable(ext, p)) {
    return { mode: 'native', outExt: '', ffmpegArgs: [] };
  }

  // Audio-only, non-native → transcode to AAC/m4a.
  if (!p.hasVideo) {
    return {
      mode: 'transcode',
      outExt: 'm4a',
      ffmpegArgs: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
    };
  }

  const v = norm(p.videoCodec);
  const a = norm(p.audioCodec);

  // Fast path: video is browser-decodable and MP4-compatible — just rewrap the
  // container, copying video; copy audio when MP4-safe, else re-encode audio only.
  if (REMUX_MP4_VCODECS.has(v)) {
    const audioArgs = !a || MP4_AUDIO_COPY_OK.has(a) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k'];
    return {
      mode: 'remux',
      outExt: 'mp4',
      ffmpegArgs: ['-c:v', 'copy', ...audioArgs, '-movflags', '+faststart'],
    };
  }

  // Universal fallback: re-encode to H.264 + AAC in a faststart MP4.
  const audioArgs = p.audioCodec ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an'];
  return {
    mode: 'transcode',
    outExt: 'mp4',
    ffmpegArgs: [
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      ...audioArgs, '-movflags', '+faststart',
    ],
  };
}
