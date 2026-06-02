import { describe, it, expect } from 'vitest';
import { decidePlayback, isBrowserPlayable, extOf } from '../src/main/services/video-playback-decide';

describe('extOf', () => {
  it('extracts lowercase extension', () => {
    expect(extOf('C:/x/Movie.MKV')).toBe('mkv');
    expect(extOf('/a/b/clip.mp4')).toBe('mp4');
    expect(extOf('noext')).toBe('');
  });
});

describe('isBrowserPlayable', () => {
  it('mp4 + h264/aac is playable', () => {
    expect(isBrowserPlayable('mp4', { hasVideo: true, videoCodec: 'h264', audioCodec: 'aac' })).toBe(true);
  });
  it('webm + vp9/opus is playable', () => {
    expect(isBrowserPlayable('webm', { hasVideo: true, videoCodec: 'vp9', audioCodec: 'opus' })).toBe(true);
  });
  it('mkv is never directly playable even with h264', () => {
    expect(isBrowserPlayable('mkv', { hasVideo: true, videoCodec: 'h264', audioCodec: 'aac' })).toBe(false);
  });
  it('mp4 + hevc is NOT playable (codec)', () => {
    expect(isBrowserPlayable('mp4', { hasVideo: true, videoCodec: 'hevc', audioCodec: 'aac' })).toBe(false);
  });
  it('mp3 audio is playable; wma is not', () => {
    expect(isBrowserPlayable('mp3', { hasVideo: false, audioCodec: 'mp3' })).toBe(true);
    expect(isBrowserPlayable('wma', { hasVideo: false, audioCodec: 'wmav2' })).toBe(false);
  });
});

describe('decidePlayback', () => {
  it('native for mp4/h264/aac (no ffmpeg work)', () => {
    const plan = decidePlayback('a.mp4', { hasVideo: true, videoCodec: 'h264', audioCodec: 'aac' });
    expect(plan.mode).toBe('native');
    expect(plan.ffmpegArgs).toEqual([]);
  });

  it('remux MKV/H.264/AAC → mp4 with stream copy (fast)', () => {
    const plan = decidePlayback('movie.mkv', { hasVideo: true, videoCodec: 'h264', audioCodec: 'aac' });
    expect(plan.mode).toBe('remux');
    expect(plan.outExt).toBe('mp4');
    expect(plan.ffmpegArgs).toContain('copy'); // -c:v copy
    expect(plan.ffmpegArgs.join(' ')).toContain('-c:v copy');
    expect(plan.ffmpegArgs.join(' ')).toContain('-c:a copy'); // aac is mp4-copy-safe
  });

  it('remux MOV/H.264 with Opus audio → copy video, re-encode audio to aac', () => {
    const plan = decidePlayback('clip.mov', { hasVideo: true, videoCodec: 'h264', audioCodec: 'opus' });
    expect(plan.mode).toBe('remux');
    expect(plan.ffmpegArgs.join(' ')).toContain('-c:v copy');
    expect(plan.ffmpegArgs.join(' ')).toContain('-c:a aac'); // opus not mp4-copy-safe
  });

  it('transcode HEVC → h264/aac mp4 (browser cannot decode hevc)', () => {
    const plan = decidePlayback('uhd.mp4', { hasVideo: true, videoCodec: 'hevc', audioCodec: 'aac' });
    expect(plan.mode).toBe('transcode');
    expect(plan.outExt).toBe('mp4');
    expect(plan.ffmpegArgs.join(' ')).toContain('libx264');
    expect(plan.ffmpegArgs.join(' ')).toContain('-c:a aac');
  });

  it('transcode legacy AVI/MPEG-4(DivX) → h264/aac mp4', () => {
    const plan = decidePlayback('old.avi', { hasVideo: true, videoCodec: 'mpeg4', audioCodec: 'mp3' });
    expect(plan.mode).toBe('transcode');
    expect(plan.ffmpegArgs.join(' ')).toContain('libx264');
  });

  it('transcode WMV/VC-1 → mp4', () => {
    expect(decidePlayback('x.wmv', { hasVideo: true, videoCodec: 'vc1', audioCodec: 'wmav2' }).mode).toBe('transcode');
  });

  it('transcode non-native audio (wma) → m4a (no video stream → -vn)', () => {
    const plan = decidePlayback('song.wma', { hasVideo: false, audioCodec: 'wmav2' });
    expect(plan.mode).toBe('transcode');
    expect(plan.outExt).toBe('m4a');
    expect(plan.ffmpegArgs).toContain('-vn');
  });

  it('transcode silent exotic video uses -an (no audio stream)', () => {
    const plan = decidePlayback('x.ts', { hasVideo: true, videoCodec: 'mpeg2video' });
    expect(plan.mode).toBe('transcode');
    expect(plan.ffmpegArgs).toContain('-an');
  });
});
