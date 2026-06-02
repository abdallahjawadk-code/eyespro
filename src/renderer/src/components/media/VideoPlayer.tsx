/**
 * VideoPlayer — مشغّل فيديو مدمج داخل البرنامج
 * يدعم: MP4/H.264, WebM, MP3, M4A وكل صيغ HTML5
 * يفتح في modal كامل فوق الواجهة
 */
import { useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  src: string;
  title?: string;
  filePath?: string;  // original file path for external player fallback
  onClose: () => void;
}

export function VideoPlayer({ src, title, filePath, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playerSrc, setPlayerSrc] = useState(src);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Editing panel states
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'trim' | 'watermark' | 'resize'>('trim');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkPos, setWatermarkPos] = useState('bottom_right');
  const [resizePlatform, setResizePlatform] = useState<'youtube' | 'tiktok' | 'instagram_reel' | 'instagram_square' | 'twitter'>('tiktok');
  const [editLoading, setEditLoading] = useState(false);
  const [editMsg, setEditMsg] = useState<{ type: 'success' | 'error'; text: string; outputPath?: string } | null>(null);

  const isAudio = src.match(/\.(mp3|m4a|aac|ogg|wav|flac)$/i) != null;

  useEffect(() => {
    setPlayerSrc(src);
    setShowEditPanel(false);
    setEditMsg(null);
  }, [src]);

  useEffect(() => {
    if (duration > 0 && trimEnd === 0) {
      setTrimEnd(Number(duration.toFixed(1)));
    }
  }, [duration]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;

    const onPlay  = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime  = () => setProgress(v.currentTime);
    const onMeta  = () => { setDuration(v.duration); setLoaded(true); };
    const onCanPlay = () => setLoaded(true);
    const onErr   = () => {
      const code = v.error?.code;
      const msg = code === 4
        ? 'صيغة الفيديو غير مدعومة — استخدم "فتح خارجياً" أو انتظر تحويله إلى H.264'
        : 'تعذّر تشغيل الملف — تأكد أنه مكتمل التحميل';
      setError(msg);
    };

    v.addEventListener('play',            onPlay);
    v.addEventListener('pause',           onPause);
    v.addEventListener('timeupdate',      onTime);
    v.addEventListener('loadedmetadata',  onMeta);
    v.addEventListener('canplay',         onCanPlay);
    v.addEventListener('error',           onErr);
    return () => {
      v.removeEventListener('play',           onPlay);
      v.removeEventListener('pause',          onPause);
      v.removeEventListener('timeupdate',     onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('canplay',        onCanPlay);
      v.removeEventListener('error',          onErr);
    };
  }, [playerSrc, volume]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = (parseFloat(e.target.value) / 100) * duration;
  }

  function changeVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) videoRef.current.volume = val;
    setMuted(val === 0);
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function toggleFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    if (!document.fullscreenElement) {
      void v.requestFullscreen();
      setFullscreen(true);
    } else {
      void document.exitFullscreen();
      setFullscreen(false);
    }
  }

  function fmt(s: number) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  async function handleTrim() {
    if (!filePath) return;
    setEditLoading(true);
    setEditMsg(null);
    try {
      const res = await window.eyespro.downloader.trim(filePath, trimStart, trimEnd);
      if (res.ok && res.data?.outputPath) {
        setEditMsg({
          type: 'success',
          text: `تم قص الفيديو بنجاح!`,
          outputPath: res.data.outputPath
        });
      } else {
        setEditMsg({
          type: 'error',
          text: `فشلت عملية القص: ${res.error || 'خطأ غير معروف'}`
        });
      }
    } catch (err) {
      setEditMsg({
        type: 'error',
        text: `حدث خطأ أثناء معالجة العملية: ${(err as Error).message}`
      });
    } finally {
      setEditLoading(false);
    }
  }

  async function handleWatermark() {
    if (!filePath || !watermarkText.trim()) return;
    setEditLoading(true);
    setEditMsg(null);
    try {
      const res = await window.eyespro.downloader.watermark(filePath, watermarkText.trim(), watermarkPos);
      if (res.ok && res.data?.outputPath) {
        setEditMsg({
          type: 'success',
          text: `تمت إضافة العلامة المائية بنجاح!`,
          outputPath: res.data.outputPath
        });
      } else {
        setEditMsg({
          type: 'error',
          text: `فشلت إضافة العلامة المائية: ${res.error || 'خطأ غير معروف'}`
        });
      }
    } catch (err) {
      setEditMsg({
        type: 'error',
        text: `حدث خطأ أثناء معالجة العملية: ${(err as Error).message}`
      });
    } finally {
      setEditLoading(false);
    }
  }

  async function handleResize() {
    if (!filePath) return;
    setEditLoading(true);
    setEditMsg(null);
    try {
      const res = await window.eyespro.downloader.resize(filePath, resizePlatform);
      if (res.ok && res.data?.outputPath) {
        setEditMsg({
          type: 'success',
          text: `تم تغيير أبعاد الفيديو بنجاح!`,
          outputPath: res.data.outputPath
        });
      } else {
        setEditMsg({
          type: 'error',
          text: `فشل تغيير الأبعاد: ${res.error || 'خطأ غير معروف'}`
        });
      }
    } catch (err) {
      setEditMsg({
        type: 'error',
        text: `حدث خطأ أثناء معالجة العملية: ${(err as Error).message}`
      });
    } finally {
      setEditLoading(false);
    }
  }

  const pct = duration ? (progress / duration) * 100 : 0;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px 24px 40px 24px',
        overflowY: 'auto'
      }}
    >
      {/* Header */}
      <div style={{
        width: '100%', maxWidth: 900,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <span style={{ color: '#e5e7eb', fontSize: 14, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isAudio ? '🎵' : '▶'} {title || 'مشغّل الوسائط'}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 22, cursor: 'pointer', padding: '2px 8px', lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* Video / Audio element */}
      <div style={{ width: '100%', maxWidth: 900, background: '#000', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
        {isAudio ? (
          <>
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}>
              <span style={{ fontSize: 64 }}>🎵</span>
            </div>
            <audio ref={videoRef as unknown as React.RefObject<HTMLVideoElement>} src={playerSrc} autoPlay />
          </>
        ) : (
          <div style={{ position: 'relative' }}>
            <video
              ref={videoRef}
              src={playerSrc}
              autoPlay
              style={{ width: '100%', maxHeight: '50vh', display: 'block', background: '#000', minHeight: 200 }}
              onClick={togglePlay}
            />
            {/* Loading spinner overlay */}
            {!loaded && !error && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}>
                <span style={{ fontSize: 48, color: '#fff' }}>⏳</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: '#f87171', fontSize: 12, flex: 1 }}>⚠️ {error}</span>
          {filePath && (
            <button
              onClick={() => void window.eyespro.downloader.openFile(filePath)}
              style={{ ...btnStyle, background: 'rgba(248,113,113,0.2)', border: '1px solid rgba(248,113,113,0.4)', color: '#fca5a5', padding: '4px 12px', borderRadius: 6 }}
            >
              📂 فتح بمشغّل النظام
            </button>
          )}
        </div>
      )}

      {/* Controls */}
      <div style={{
        width: '100%', maxWidth: 900, marginTop: 12,
        background: 'rgba(17,24,39,0.95)', borderRadius: 10,
        padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* Seek bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#9ca3af', fontSize: 11, minWidth: 36 }}>{fmt(progress)}</span>
          <div style={{ flex: 1, position: 'relative', height: 4 }}>
            <div style={{ position: 'absolute', inset: 0, background: '#374151', borderRadius: 2 }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, background: '#e63946', borderRadius: 2 }} />
            <input
              type="range" min={0} max={100} step={0.1}
              value={pct}
              onChange={seek}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer' }}
            />
          </div>
          <span style={{ color: '#9ca3af', fontSize: 11, minWidth: 36, textAlign: 'end' }}>{fmt(duration)}</span>
        </div>

        {/* Buttons row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Play/Pause */}
          <button onClick={togglePlay} style={btnStyle}>
            {playing ? '⏸' : '▶'}
          </button>

          {/* Mute */}
          <button onClick={toggleMute} style={btnStyle}>
            {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
          </button>

          {/* Volume */}
          <input
            type="range" min={0} max={1} step={0.05}
            value={muted ? 0 : volume}
            onChange={changeVolume}
            style={{ width: 70, accentColor: '#e63946', cursor: 'pointer' }}
          />

          <span style={{ flex: 1 }} />

          {/* Skip -10s */}
          <button onClick={() => { if (videoRef.current) videoRef.current.currentTime -= 10; }} style={btnStyle} title="-10 ثانية">
            ⏮ 10s
          </button>

          {/* Skip +10s */}
          <button onClick={() => { if (videoRef.current) videoRef.current.currentTime += 10; }} style={btnStyle} title="+10 ثانية">
            10s ⏭
          </button>

          {/* Speed */}
          {[0.5, 1, 1.5, 2].map((s) => (
            <button key={s} onClick={() => { if (videoRef.current) videoRef.current.playbackRate = s; }} style={{
              ...btnStyle,
              color: videoRef.current?.playbackRate === s ? '#e63946' : '#9ca3af',
            }}>
              {s}×
            </button>
          ))}

          {/* Fullscreen */}
          {!isAudio && (
            <button onClick={toggleFullscreen} style={btnStyle}>
              {fullscreen ? '⛶' : '⛶'}
            </button>
          )}

          {/* Toggle Edit Panel */}
          {filePath && !isAudio && (
            <button
              onClick={() => setShowEditPanel(!showEditPanel)}
              style={{
                ...btnStyle,
                color: showEditPanel ? '#e63946' : '#d1d5db',
                border: `1px solid ${showEditPanel ? '#e63946' : 'rgba(255,255,255,0.1)'}`,
                padding: '2px 8px',
                borderRadius: 4,
                background: showEditPanel ? 'rgba(230,57,70,0.1)' : 'rgba(255,255,255,0.05)',
                fontSize: 12,
              }}
            >
              ⚙️ تعديل الفيديو
            </button>
          )}
        </div>
      </div>

      {/* Editing panel (rendered inside modal below controls) */}
      {showEditPanel && filePath && (
        <div style={{
          width: '100%', maxWidth: 900, marginTop: 12,
          background: 'rgba(24, 32, 49, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 10,
          padding: 16,
          color: '#e5e7eb',
          direction: 'rtl',
        }}>
          {/* Tabs header */}
          <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8, marginBottom: 12 }}>
            <button
              onClick={() => { setActiveTab('trim'); setEditMsg(null); }}
              style={{
                background: 'none', border: 'none',
                color: activeTab === 'trim' ? '#e63946' : '#9ca3af',
                fontWeight: activeTab === 'trim' ? 'bold' : 'normal',
                cursor: 'pointer', fontSize: 13,
                borderBottom: activeTab === 'trim' ? '2px solid #e63946' : 'none',
                paddingBottom: 6, transition: 'all 0.2s',
              }}
            >
              ✂️ قص الفيديو
            </button>
            <button
              onClick={() => { setActiveTab('watermark'); setEditMsg(null); }}
              style={{
                background: 'none', border: 'none',
                color: activeTab === 'watermark' ? '#e63946' : '#9ca3af',
                fontWeight: activeTab === 'watermark' ? 'bold' : 'normal',
                cursor: 'pointer', fontSize: 13,
                borderBottom: activeTab === 'watermark' ? '2px solid #e63946' : 'none',
                paddingBottom: 6, transition: 'all 0.2s',
              }}
            >
              🏷️ علامة مائية
            </button>
            <button
              onClick={() => { setActiveTab('resize'); setEditMsg(null); }}
              style={{
                background: 'none', border: 'none',
                color: activeTab === 'resize' ? '#e63946' : '#9ca3af',
                fontWeight: activeTab === 'resize' ? 'bold' : 'normal',
                cursor: 'pointer', fontSize: 13,
                borderBottom: activeTab === 'resize' ? '2px solid #e63946' : 'none',
                paddingBottom: 6, transition: 'all 0.2s',
              }}
            >
              📐 تغيير الأبعاد
            </button>
          </div>

          {/* Tab content */}
          {activeTab === 'trim' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>وقت البدء (بالثواني):</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number" step="0.1" min="0" max={duration}
                      value={trimStart}
                      onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                      style={inputStyle}
                    />
                    <button
                      onClick={() => setTrimStart(Number(progress.toFixed(1)))}
                      style={btnOutlineStyle}
                      title="تعيين الوقت الحالي للفيديو"
                    >
                      🚩 الوقت الحالي ({fmt(progress)})
                    </button>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>وقت النهاية (بالثواني):</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number" step="0.1" min="0" max={duration}
                      value={trimEnd}
                      onChange={(e) => setTrimEnd(parseFloat(e.target.value) || 0)}
                      style={inputStyle}
                    />
                    <button
                      onClick={() => setTrimEnd(Number(progress.toFixed(1)))}
                      style={btnOutlineStyle}
                      title="تعيين الوقت الحالي للفيديو"
                    >
                      🚩 الوقت الحالي ({fmt(progress)})
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={handleTrim}
                disabled={editLoading || trimEnd <= trimStart}
                style={editLoading || trimEnd <= trimStart ? btnDisabledStyle : btnPrimaryStyle}
              >
                {editLoading ? '⏳ جاري معالجة القص...' : '✂️ تطبيق قص الفيديو'}
              </button>
            </div>
          )}

          {activeTab === 'watermark' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>نص العلامة المائية:</label>
                <input
                  type="text"
                  placeholder="مثال: EyesPro"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>الموقع:</label>
                <select
                  value={watermarkPos}
                  onChange={(e) => setWatermarkPos(e.target.value)}
                  style={inputStyle}
                >
                  <option value="bottom_right">أسفل اليمين</option>
                  <option value="bottom_left">أسفل اليسار</option>
                  <option value="top_right">أعلى اليمين</option>
                  <option value="top_left">أعلى اليسار</option>
                  <option value="center">المنتصف</option>
                </select>
              </div>
              <button
                onClick={handleWatermark}
                disabled={editLoading || !watermarkText.trim()}
                style={editLoading || !watermarkText.trim() ? btnDisabledStyle : btnPrimaryStyle}
              >
                {editLoading ? '⏳ جاري إضافة العلامة المائية...' : '🏷️ تطبيق إضافة العلامة المائية'}
              </button>
            </div>
          )}

          {activeTab === 'resize' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 4 }}>اختر أبعاد المنصة المستهدفة:</label>
                <select
                  value={resizePlatform}
                  onChange={(e) => setResizePlatform(e.target.value as any)}
                  style={inputStyle}
                >
                  <option value="tiktok">تيك توك / ريلز (9:16 - عمودي)</option>
                  <option value="youtube">يوتيوب (16:9 - عرضي)</option>
                  <option value="instagram_square">إنستغرام (1:1 - مربع)</option>
                  <option value="twitter">تويتر (1280x720)</option>
                </select>
              </div>
              <button
                onClick={handleResize}
                disabled={editLoading}
                style={editLoading ? btnDisabledStyle : btnPrimaryStyle}
              >
                {editLoading ? '⏳ جاري تغيير الأبعاد...' : '📐 تطبيق تغيير الأبعاد'}
              </button>
            </div>
          )}

          {/* Feedback messages */}
          {editMsg && (
            <div style={{
              marginTop: 12, padding: 10, borderRadius: 6,
              fontSize: 12, textAlign: 'center',
              background: editMsg.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              border: `1px solid ${editMsg.type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
              color: editMsg.type === 'error' ? '#f87171' : '#34d399',
            }}>
              <span style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>{editMsg.text}</span>
              {editMsg.outputPath && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <button
                    onClick={() => void window.eyespro.downloader.openFile(editMsg.outputPath!)}
                    style={btnSubStyle}
                  >
                    📂 تشغيل بمشغل النظام
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await window.eyespro.downloader.mediaUrl(editMsg.outputPath!);
                        if (res.ok && res.data) {
                          setPlayerSrc(res.data);
                          setEditMsg(null);
                        }
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                    style={btnSubStyle}
                  >
                    🔄 تحميل في المشغل هنا
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'none', border: 'none',
  color: '#d1d5db', fontSize: 16, cursor: 'pointer',
  padding: '2px 6px', borderRadius: 4,
  lineHeight: 1,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  color: '#fff',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const btnOutlineStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 6,
  color: '#e5e7eb',
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 11,
  whiteSpace: 'nowrap',
};

const btnPrimaryStyle: React.CSSProperties = {
  width: '100%',
  background: '#e63946',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  padding: '10px 16px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 'bold',
  marginTop: 8,
};

const btnDisabledStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(230, 57, 70, 0.4)',
  border: 'none',
  borderRadius: 6,
  color: 'rgba(255,255,255,0.6)',
  padding: '10px 16px',
  cursor: 'not-allowed',
  fontSize: 13,
  fontWeight: 'bold',
  marginTop: 8,
};

const btnSubStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 6,
  color: '#e5e7eb',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 11,
};
