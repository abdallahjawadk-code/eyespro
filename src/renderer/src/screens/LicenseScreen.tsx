import { useState, useEffect } from 'react';
import './LicenseScreen.css';

interface Props {
  onActivated: () => void;
  trialExpired?: boolean;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

export function LicenseScreen({ onActivated, trialExpired = false }: Props) {
  const [serial, setSerial]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [machineId, setMachineId]   = useState('');
  const [countdown, setCountdown]   = useState<number | null>(null);

  useEffect(() => {
    window.eyespro.license.info().then((r: { machine_id: string }) => {
      setMachineId(r.machine_id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!trialExpired) {
      window.eyespro.license.status().then((r: { ok: boolean; trialRemainingMs?: number }) => {
        if (r.ok && r.trialRemainingMs != null) setCountdown(r.trialRemainingMs);
      }).catch(() => {});
    }
  }, [trialExpired]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c !== null ? Math.max(0, c - 1000) : null), 1000);
    return () => clearInterval(t);
  }, [countdown !== null]);

  async function activate() {
    const key = serial.trim();
    if (key.length < 8) { setError('أدخل رمز التفعيل الكامل'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await window.eyespro.license.activate(key) as { ok: boolean; error?: string };
      if (res.ok) { onActivated(); }
      else { setError(res.error ?? 'فشل التفعيل'); }
    } catch {
      setError('تعذّر الاتصال بخادم التراخيص');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lic-overlay">
      <div className="lic-card">
        <div className="lic-logo">
          <span className="lic-eye">👁</span>
          <span className="lic-brand">Masar Network</span>
        </div>

        {trialExpired ? (
          <>
            <div className="lic-trial-expired">
              <span className="lic-trial-icon">⏰</span>
              <h1 className="lic-title">انتهت الفترة التجريبية</h1>
              <p className="lic-sub">أدخل رمز التفعيل لمواصلة استخدام البرنامج</p>
            </div>
          </>
        ) : (
          <>
            <h1 className="lic-title">تفعيل البرنامج</h1>
            {countdown !== null && countdown > 0 && (
              <div className="lic-trial-banner">
                <span className="lic-trial-label">الفترة التجريبية تنتهي بعد</span>
                <span className="lic-trial-clock">{formatCountdown(countdown)}</span>
              </div>
            )}
            <p className="lic-sub">أدخل رمز التفعيل للمتابعة</p>
          </>
        )}

        <div className="lic-field">
          <label className="lic-label">رمز التفعيل</label>
          <input
            className="lic-input"
            dir="ltr"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            value={serial}
            onChange={e => setSerial(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && activate()}
            spellCheck={false}
            autoFocus
          />
        </div>

        {error && <p className="lic-error">{error}</p>}

        <button className="lic-btn" onClick={activate} disabled={loading || serial.trim().length < 8}>
          {loading ? 'جارٍ التفعيل...' : 'تفعيل البرنامج'}
        </button>

        <div className="lic-footer">
          <span className="lic-mid-label">معرّف الجهاز:</span>
          <code className="lic-mid">{machineId || '...'}</code>
          <p className="lic-hint">أرسل معرّف الجهاز إلى الدعم الفني إذا واجهتك مشكلة في التفعيل</p>
        </div>
      </div>
    </div>
  );
}
