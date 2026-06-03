/**
 * Social Video Hub — مركز الفيديو الاجتماعي
 * تنزيل ← عرض ← استخراج صوت
 */
import { useEffect, useRef, useState } from 'react';
import { useTabParam } from '../../core/hooks/useTabParam';
import { useTranslation } from 'react-i18next';
import type { DownloadJob, DownloadQuality, LocalFile, VideoInfo } from '../../../../shared/api-types';
import { Btn, Card, Input, Msg, Panel, Toolbar } from '../../ui';
import { Workspace } from '../../shell/Workspace';
import { VideoPlayer } from '../../components/media/VideoPlayer';
import { SharePanel } from '../../components/media/SharePanel';

// ─── Constants ────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDur(sec: number) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function isAudio(path: string) { return /\.(mp3|m4a|wav|ogg|flac)$/i.test(path); }

// ─── Component ────────────────────────────────────────────────────────────────

type Tab = 'download' | 'library';

function parseTab(raw: string | null): Tab {
  return raw === 'library' ? 'library' : 'download';
}

export function SocialVideoDomain() {
  const { t, i18n } = useTranslation();
  const QUALITIES: { value: DownloadQuality; label: string }[] = [
    { value: 'best',       label: t('downloader.qualityBest') },
    { value: '1080p',      label: '🎬 1080p Full HD' },
    { value: '720p',       label: '📺 720p HD' },
    { value: '480p',       label: '📱 480p' },
    { value: '360p',       label: '💾 360p' },
    { value: 'audio_only', label: `${t('downloader.qualityAudio')} (MP3)` },
  ];
  const [tab, setTab]         = useTabParam<Tab>(parseTab);
  const [ytdlpReady, setReady]   = useState<boolean | null>(null);
  const [ytdlpVersion, setVer]   = useState('');
  const [installing, setInst]    = useState(false);
  const [updating, setUpdating]  = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  // Media engine (ffmpeg) — universal in-app playback + self-update from its server
  const [mediaSource, setMediaSource] = useState<'updated' | 'bundled' | null>(null);
  const [ffUpdating, setFfUpdating]   = useState(false);
  const [ffMsg, setFfMsg]             = useState('');

  useEffect(() => {
    window.eyespro.video.mediaToolsStatus()
      .then((r) => { if (r.ok && r.data) setMediaSource(r.data.source); })
      .catch(() => undefined);
  }, []);

  async function updateMediaEngine() {
    setFfUpdating(true); setFfMsg('');
    try {
      const r = await window.eyespro.video.updateMediaTools();
      if (r.ok && r.data?.ok) {
        setMediaSource('updated');
        setFfMsg('✅ ' + t('mediaEngine.updated', { defaultValue: 'Media engine updated to the latest version' }));
      } else {
        setFfMsg('⚠️ ' + t('mediaEngine.updateFailed', { defaultValue: 'Update failed — running the bundled version' }));
      }
    } catch {
      setFfMsg('⚠️ ' + t('mediaEngine.updateUnreachable', { defaultValue: 'Could not reach the update server — running the bundled version' }));
    } finally {
      setFfUpdating(false);
    }
  }

  // Download
  const [url, setUrl]         = useState('');
  const [info, setInfo]       = useState<VideoInfo | null>(null);
  const [infoLoading, setInfoL] = useState(false);
  const [quality, setQuality] = useState<DownloadQuality>('best');
  const [dlJobs, setDlJobs]   = useState<DownloadJob[]>([]);
  const [dlMsg, setDlMsg]     = useState('');

  // Audio extraction (in download tab)
  const [audioFile, setAudioFile] = useState<LocalFile | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioMsg, setAudioMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  // Library
  const [files, setFiles]     = useState<LocalFile[]>([]);

  // Player
  const [player, setPlayer]   = useState<{ src: string; title: string; filePath?: string } | null>(null);
  // Share
  const [share, setShare]     = useState<{ url: string; title: string } | null>(null);

  const dlListener = useRef(false);

  useEffect(() => {
    void window.eyespro.downloader.status().then((r) => {
      if (r.ok && r.data) { setReady(r.data.installed); setVer(r.data.version ?? ''); }
    });
    loadFiles();
    if (!dlListener.current) {
      dlListener.current = true;
      window.eyespro.on?.('downloader:progress', (job: unknown) => {
        const j = job as DownloadJob;
        setDlJobs((prev) => {
          const i = prev.findIndex((x) => x.id === j.id);
          if (i >= 0) { const n = [...prev]; n[i] = j; return n; }
          return [j, ...prev];
        });
        if (j.status === 'done') loadFiles();
      });
    }
  }, []);

  function loadFiles() {
    void window.eyespro.downloader.scan().then((r) => {
      if (r.ok && r.data) setFiles(r.data);
    });
  }

  async function installYtDlp() {
    setInst(true);
    const r = await window.eyespro.downloader.install();
    setInst(false);
    if (r.ok) {
      setReady(true);
      const s = await window.eyespro.downloader.status();
      if (s.ok && s.data) setVer(s.data.version ?? '');
    }
  }

  async function manualUpdate() {
    setUpdating(true); setUpdateMsg('');
    const r = await window.eyespro.downloader.update();
    setUpdating(false);
    if (r.ok && r.data) {
      setUpdateMsg(r.data.updated ? t('socialVideo.updateSuccess', { version: r.data.version }) : t('socialVideo.updateLatest', { version: r.data.version }));
      const s = await window.eyespro.downloader.status();
      if (s.ok && s.data) setVer(s.data.version ?? '');
    } else {
      setUpdateMsg(t('socialVideo.updateFailed'));
    }
  }

  async function fetchInfo() {
    if (!url.trim()) return;
    setInfoL(true); setInfo(null); setDlMsg('');
    const r = await window.eyespro.downloader.info(url.trim());
    setInfoL(false);
    if (r.ok && r.data) setInfo(r.data);
    else setDlMsg(r.error ?? t('socialVideo.previewFetchFailed'));
  }

  async function startDownload() {
    if (!url.trim()) return;
    const jobId = `dl_${Date.now()}`;
    setDlMsg('');
    const r = await window.eyespro.downloader.start(url.trim(), quality, jobId);
    if (!r.ok) setDlMsg(r.error ?? t('socialVideo.downloadStartFailed'));
    else { setUrl(''); setInfo(null); }
  }

  async function openPlayer(file: LocalFile) {
    const r = await window.eyespro.downloader.mediaUrl(file.path);
    if (r.ok && r.data) setPlayer({ src: r.data, title: file.name, filePath: file.path });
  }

  async function extractAudio(file: LocalFile) {
    setAudioBusy(true); setAudioMsg(null);
    const r = await window.eyespro.downloader.extractAudio(file.path);
    setAudioBusy(false);
    if (r.ok && r.data) {
      setAudioMsg({ ok: true, text: t('socialVideo.audioExtractSuccess', { file: r.data.outputPath.split(/[/\\]/).pop() }) });
      loadFiles();
    } else {
      setAudioMsg({ ok: false, text: r.error ?? t('socialVideo.audioExtractFailed') });
    }
  }

  async function deleteFile(file: LocalFile) {
    if (!window.confirm(t('socialVideo.deleteConfirm', { name: file.name }))) return;
    await window.eyespro.downloader.delete(file.path);
    if (audioFile?.path === file.path) setAudioFile(null);
    loadFiles();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {player && (
        <VideoPlayer
          src={player.src}
          title={player.title}
          filePath={player.filePath}
          onClose={() => setPlayer(null)}
        />
      )}
      {share && (
        <SharePanel
          url={share.url}
          title={share.title}
          onClose={() => setShare(null)}
        />
      )}

      <Workspace
        eyebrow={t('socialVideo.eyebrow')}
        title={t('socialVideo.title')}
        description={t('socialVideo.description')}
      >
        <Panel>

          {/* yt-dlp status bar */}
          <div style={{
            marginBottom: 16, padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg2)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            {ytdlpReady === null && (
              <span style={{ fontSize: 12, color: 'var(--t2)' }}>{t('downloader.statusChecking')}</span>
            )}
            {ytdlpReady === false && (
              <>
                <span style={{ fontSize: 12, color: 'var(--warn)', flex: 1 }}>{t('downloader.statusNotInstalled')}</span>
                <Btn variant="primary" style={{ fontSize: 11 }} disabled={installing} onClick={() => void installYtDlp()}>
                  {installing ? t('downloader.installing') : t('downloader.installBtn')}
                </Btn>
              </>
            )}
            {ytdlpReady === true && (
              <>
                <span style={{ fontSize: 12, color: 'var(--ok)' }}>✅ yt-dlp</span>
                {ytdlpVersion && (
                  <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>{ytdlpVersion}</span>
                )}
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>{t('socialVideo.updateGithubHint')}</span>
                <span style={{ flex: 1 }} />
                {updateMsg && (
                  <span style={{ fontSize: 11, color: updateMsg.startsWith('✅') ? 'var(--ok)' : 'var(--warn)' }}>{updateMsg}</span>
                )}
                <Btn variant="ghost" style={{ fontSize: 11 }} disabled={updating} onClick={() => void manualUpdate()}>
                  {updating ? t('socialVideo.updateChecking') : t('socialVideo.updateCheck')}
                </Btn>
              </>
            )}
          </div>

          {/* Media engine (ffmpeg) — يشغّل كل صيغ الفيديو داخلياً بلا مشغّل خارجي */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--ok)' }}>🎞️ {t('mediaEngine.title', { defaultValue: 'Media engine' })}</span>
            {mediaSource && (
              <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>
                {mediaSource === 'updated'
                  ? t('mediaEngine.latest', { defaultValue: 'Latest version' })
                  : t('mediaEngine.bundled', { defaultValue: 'Bundled version (full)' })}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>{t('mediaEngine.subtitle', { defaultValue: 'Plays every format in-app' })}</span>
            <span style={{ flex: 1 }} />
            {ffMsg && (
              <span style={{ fontSize: 11, color: ffMsg.startsWith('✅') ? 'var(--ok)' : 'var(--warn)' }}>{ffMsg}</span>
            )}
            <Btn variant="ghost" style={{ fontSize: 11 }} disabled={ffUpdating} onClick={() => void updateMediaEngine()}>
              {ffUpdating ? t('mediaEngine.updating', { defaultValue: 'Updating…' }) : t('mediaEngine.updateBtn', { defaultValue: 'Update media engine' })}
            </Btn>
          </div>

          {/* Tab bar */}
          <Toolbar style={{ marginBottom: 16 }}>
            <Btn variant={tab === 'download' ? 'primary' : 'ghost'} onClick={() => setTab('download')}>
              {t('socialVideo.downloadTab')}
            </Btn>
            <Btn variant={tab === 'library' ? 'primary' : 'ghost'} onClick={() => setTab('library')}>
              {t('socialVideo.libraryTab', { count: files.length })}
            </Btn>
            <span style={{ flex: 1 }} />
            <Btn variant="ghost" style={{ fontSize: 12 }} onClick={() => void window.eyespro.downloader.openFolder()}>
              {t('downloader.openFolder')}
            </Btn>
          </Toolbar>

          {/* ══════════════════════ DOWNLOAD TAB ══════════════════════ */}
          {tab === 'download' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* URL input */}
              <Card title={t('socialVideo.urlInputTitle')}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <Input
                    dir="ltr"
                    style={{ flex: 1 }}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void fetchInfo(); }}
                    placeholder={t('socialVideo.urlInputPlaceholder')}
                  />
                  <Btn onClick={() => void fetchInfo()} disabled={!url.trim() || infoLoading || !ytdlpReady}>
                    {infoLoading ? '⏳' : `🔍 ${t('socialVideo.previewBtn')}`}
                  </Btn>
                </div>

                {dlMsg && <Msg tone="err">{dlMsg}</Msg>}

                {/* Platform badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    [t('monitor.sourceTypes.youtube'), '▶️'],
                    [t('monitor.sourceTypes.tiktok'), '🎵'],
                    [t('monitor.sourceTypes.instagram'), '📸'],
                    [t('monitor.sourceTypes.twitter'), '𝕏'],
                    [t('monitor.sourceTypes.facebook'), '🇫'],
                    [i18n.language === 'ar' ? 'تيليغرام' : 'Telegram', '✈️'],
                    ['Vimeo', '🎞'],
                    ['SoundCloud', '🎧'],
                    [i18n.language === 'ar' ? '+1000 موقع' : '1000+ sites', '🌐'],
                  ].map(([n, i]) => (
                    <span key={n} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: 'var(--bg3)', color: 'var(--t2)' }}>
                      {i} {n}
                    </span>
                  ))}
                </div>
              </Card>

              {/* Info preview */}
              {infoLoading && (
                <div style={{ textAlign: 'center', color: 'var(--t2)', padding: 24 }}>{t('socialVideo.previewLoading')}</div>
              )}

              {info && (
                <Card title={`📋 ${info.platform} — ${info.title}`}>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                    {info.thumbnail && (
                      <img
                        src={info.thumbnail} alt=""
                        style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{info.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--t2)', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {info.uploader && <span>👤 {info.uploader}</span>}
                        {info.duration > 0 && <span>⏱ {fmtDur(info.duration)}</span>}
                        {info.viewCount != null && <span>👁 {info.viewCount.toLocaleString(i18n.language === 'ar' ? 'ar' : 'en')}</span>}
                        {info.likeCount != null && <span>❤️ {info.likeCount.toLocaleString(i18n.language === 'ar' ? 'ar' : 'en')}</span>}
                      </div>
                      {info.description && (
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5 }}>
                          {info.description.slice(0, 180)}…
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick share before download */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                    <Btn
                      variant="ghost"
                      style={{ fontSize: 11, color: 'var(--accent)' }}
                      onClick={() => setShare({ url: info.webpage_url, title: info.title })}
                    >
                      {t('socialVideo.originalShareBtn')}
                    </Btn>
                  </div>

                  {/* Quality selector + download */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--t2)', flexShrink: 0 }}>{t('downloader.quality')}</span>
                    {QUALITIES.map((q) => (
                      <button key={q.value} onClick={() => setQuality(q.value)} style={{
                        padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                        border: `1px solid ${quality === q.value ? 'var(--accent)' : 'var(--border)'}`,
                        background: quality === q.value ? 'var(--accent-muted)' : 'var(--bg2)',
                        color: quality === q.value ? 'var(--accent)' : 'var(--t2)',
                      }}>{q.label}</button>
                    ))}
                    <Btn
                      variant="primary"
                      style={{ marginInlineStart: 'auto' }}
                      disabled={!ytdlpReady}
                      onClick={() => void startDownload()}
                    >
                      {t('socialVideo.downloadBtn')}
                    </Btn>
                  </div>
                </Card>
              )}

              {/* Active downloads */}
              {dlJobs.length > 0 && (
                <Card title={t('downloader.downloadsCount', { count: dlJobs.length })}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dlJobs.map((job) => (
                      <div key={job.id} style={{
                        padding: '8px 12px', borderRadius: 8,
                        border: '1px solid var(--border)', background: 'var(--bg2)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {job.title || job.url.slice(0, 55)}
                          </span>
                          <span style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 4, marginInlineStart: 8, flexShrink: 0,
                            background: job.status === 'done' ? 'var(--ok-soft)' : job.status === 'error' ? 'var(--err-soft)' : 'var(--accent-muted)',
                            color: job.status === 'done' ? 'var(--ok)' : job.status === 'error' ? 'var(--err)' : 'var(--accent)',
                          }}>
                            {job.status === 'done' ? t('downloader.statusDone') : job.status === 'error' ? t('downloader.statusFailed') : t('downloader.statusDownloading', { progress: job.progress })}
                          </span>
                        </div>

                        {(job.status === 'downloading' || job.status === 'pending') && (
                          <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${job.progress}%`, background: 'var(--accent)', borderRadius: 2 }} />
                          </div>
                        )}
                        {job.status === 'downloading' && (
                          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>
                            {job.speed && `🚀 ${job.speed}`}{job.eta && ` · ETA ${job.eta}`}
                          </div>
                        )}
                        {job.status === 'error' && (
                          <div style={{ fontSize: 11, color: 'var(--err)', marginTop: 3 }}>{job.error?.slice(0, 200)}</div>
                        )}
                        {job.status === 'done' && job.outputPath && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <Btn variant="primary" style={{ fontSize: 11 }} onClick={() => {
                              const f: LocalFile = { name: job.title || '', path: job.outputPath!, size: 0, ext: '.mp4', mtimeMs: Date.now() };
                              void openPlayer(f);
                            }}>{t('downloader.play')}</Btn>
                            <Btn
                              variant="ghost"
                              style={{ fontSize: 11, color: 'var(--accent)' }}
                              onClick={() => setShare({ url: job.url, title: job.title || job.url.slice(0, 60) })}
                            >
                              🔗 {t('share.title')}
                            </Btn>
                            <Btn variant="ghost" style={{ fontSize: 11 }} onClick={() => void window.eyespro.downloader.openFile(job.outputPath!)}>
                              {t('common.open')}
                            </Btn>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* ── استخراج الصوت كـ MP3 ── */}
              <Card title={t('socialVideo.audioExtractTitle')}>
                <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 10 }}>
                  {t('socialVideo.audioExtractHint')}
                </div>

                {files.filter((f) => !isAudio(f.path)).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--t3)' }}>{t('socialVideo.audioExtractEmpty')}</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {files.filter((f) => !isAudio(f.path)).map((f) => (
                        <button key={f.path} onClick={() => { setAudioFile(f); setAudioMsg(null); }} style={{
                          padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
                          border: `1.5px solid ${audioFile?.path === f.path ? 'var(--accent)' : 'var(--border)'}`,
                          background: audioFile?.path === f.path ? 'var(--accent-muted)' : 'var(--bg2)',
                          color: audioFile?.path === f.path ? 'var(--accent)' : 'var(--t1)',
                          maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          🎬 {f.name}
                        </button>
                      ))}
                    </div>

                    {audioMsg && <div style={{ marginBottom: 8 }}><Msg tone={audioMsg.ok ? 'ok' : 'err'}>{audioMsg.text}</Msg></div>}

                    <Btn
                      variant="primary"
                      disabled={!audioFile || audioBusy}
                      onClick={() => audioFile && void extractAudio(audioFile)}
                    >
                      {audioBusy ? t('socialVideo.audioExtracting') : t('socialVideo.audioExtractBtn')}
                    </Btn>
                  </>
                )}
              </Card>

            </div>
          )}

          {/* ══════════════════════ LIBRARY TAB ══════════════════════ */}
          {tab === 'library' && (
            <div>
              <Toolbar style={{ marginBottom: 12 }}>
                <Btn variant="ghost" onClick={loadFiles}>↻ {t('common.refresh')}</Btn>
                <span style={{ fontSize: 12, color: 'var(--t2)' }}>{t('socialVideo.libraryCount', { count: files.length })}</span>
              </Toolbar>

              {files.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: 'var(--t3)' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                  <div>{t('socialVideo.libraryEmpty')}</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
                  {files.map((f) => (
                    <div key={f.path} style={{
                      borderRadius: 10, border: '1px solid var(--border)',
                      background: 'var(--bg2)', overflow: 'hidden',
                    }}>
                      <div style={{
                        height: 110, background: '#0a0a0a',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 42, color: '#444', cursor: 'pointer',
                      }} onClick={() => void openPlayer(f)}>
                        {isAudio(f.path) ? '🎵' : '🎬'}
                      </div>
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, lineHeight: 1.3,
                          marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {f.name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8 }}>
                          {f.ext.toUpperCase()} · {fmtSize(f.size)}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <Btn
                            variant="primary"
                            style={{ fontSize: 10, flex: 1, padding: '3px 6px' }}
                            onClick={() => void openPlayer(f)}
                          >
                            {t('downloader.play')}
                          </Btn>
                          <Btn
                            variant="ghost"
                            style={{ fontSize: 10, padding: '3px 8px', color: 'var(--accent)' }}
                            onClick={() => setShare({ url: f.sourceUrl || '', title: f.name })}
                            title={t('socialVideo.shareTooltip')}
                          >
                            🔗
                          </Btn>
                          <Btn
                            variant="ghost"
                            style={{ fontSize: 10, padding: '3px 8px' }}
                            onClick={() => void window.eyespro.downloader.openFile(f.path)}
                            title={t('downloader.openFile')}
                          >
                            📂
                          </Btn>
                          <Btn
                            variant="ghost"
                            style={{ fontSize: 10, padding: '3px 8px', color: 'var(--err)' }}
                            onClick={() => void deleteFile(f)}
                            title={t('common.delete')}
                          >
                            🗑
                          </Btn>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </Panel>
      </Workspace>
    </>
  );
}
