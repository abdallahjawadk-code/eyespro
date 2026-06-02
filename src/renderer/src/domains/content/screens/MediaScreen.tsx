import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Btn, Empty, Loading, Msg, Panel, Toolbar } from '../../../ui';

type MediaItem = { id: number; filename: string; mime_type?: string; size?: number };

export function MediaScreen() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.eyespro.media.list().catch(() => ({ ok: false, data: [] }));
    if (res.ok && res.data) setRows(res.data as MediaItem[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function upload() {
    setMsg('');
    const res = await window.eyespro.media.pickUpload().catch(() => ({ ok: false }));
    if (res.ok) {
      setMsg(t('media.uploadOk'));
      void load();
    } else {
      setMsg(t('media.uploadFailed'));
    }
  }

  async function remove(id: number) {
    await window.eyespro.media.delete(id);
    void load();
  }

  return (
    <Panel>
      <Toolbar>
        <Btn onClick={() => void load()}>↻</Btn>
        <Btn variant="primary" onClick={() => void upload()}>{t('media.upload')}</Btn>
      </Toolbar>
      {msg && <div style={{ marginBottom: 12 }}><Msg tone="ok">{msg}</Msg></div>}
      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty title={t('media.empty')} icon="🖼️" />
      ) : (
        <div className="ui-grid ui-grid--3">
          {rows.map((m) => (
            <div key={m.id} className="ui-card">
              <div className="ui-card-body" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>🖼️</div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{m.filename}</p>
                <p style={{ margin: '4px 0 12px', fontSize: 11, color: 'var(--t2)' }}>{m.mime_type ?? '—'}</p>
                <Btn size="sm" variant="danger" onClick={() => void remove(m.id)}>{t('common.delete')}</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
