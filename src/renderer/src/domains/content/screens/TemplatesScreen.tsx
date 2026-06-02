import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Btn, Card, Empty, Field, Input, Loading, Modal, Msg, Panel, Textarea, Toolbar } from '../../../ui';

type Tab = 'article' | 'publish';

type ArticleTemplate = {
  id: number;
  name: string;
  title_template?: string | null;
  content_template?: string | null;
  category?: string | null;
};

type PublishTemplate = {
  id: number;
  name: string;
  platforms?: string | null;
};

function parsePlatforms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

export function TemplatesScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('article');
  const [articleRows, setArticleRows] = useState<ArticleTemplate[]>([]);
  const [publishRows, setPublishRows] = useState<PublishTemplate[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Separate busy flags: one per applying template (by id), one for form submit
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [artForm, setArtForm] = useState({ name: '', title_template: '', content_template: '', category: '' });
  const [pubForm, setPubForm] = useState({ name: '', platforms: new Set<string>() });

  const load = useCallback(async () => {
    setLoading(true);
    const [art, pub, plat] = await Promise.all([
      window.eyespro.templates.articleList().catch(() => ({ ok: false, data: [] })),
      window.eyespro.templates.publishList().catch(() => ({ ok: false, data: [] })),
      window.eyespro.publish.platforms().catch(() => ({ ok: false, data: [] })),
    ]);
    if (art.ok && art.data)  setArticleRows(art.data as ArticleTemplate[]);
    if (pub.ok && pub.data)  setPublishRows(pub.data as PublishTemplate[]);
    if (plat.ok && plat.data) setAvailablePlatforms(plat.data as string[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setMsg(null);
    setArtForm({ name: '', title_template: '', content_template: '', category: '' });
    setPubForm({ name: '', platforms: new Set(availablePlatforms.slice(0, 1)) });
    setShowCreate(true);
  }

  async function submitCreate() {
    setSubmitting(true);
    setMsg(null);
    try {
      if (tab === 'article') {
        if (!artForm.name.trim()) return;
        const res = await window.eyespro.templates.articleCreate({
          name: artForm.name.trim(),
          title_template:   artForm.title_template   || undefined,
          content_template: artForm.content_template || undefined,
          category:         artForm.category         || undefined,
        });
        if (res.ok) {
          setShowCreate(false);
          setMsg({ ok: true, text: t('templates.created') });
          void load();
        } else {
          setMsg({ ok: false, text: t('common.error') });
        }
      } else {
        if (!pubForm.name.trim() || pubForm.platforms.size === 0) return;
        const res = await window.eyespro.templates.publishCreate(pubForm.name.trim(), [...pubForm.platforms]);
        if (res.ok) {
          setShowCreate(false);
          setMsg({ ok: true, text: t('templates.created') });
          void load();
        } else {
          setMsg({ ok: false, text: t('common.error') });
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function removeArticle(id: number) {
    if (!confirm(t('templates.deleteConfirm'))) return;
    await window.eyespro.templates.articleDelete(id);
    void load();
  }

  async function removePublish(id: number) {
    if (!confirm(t('templates.deleteConfirm'))) return;
    await window.eyespro.templates.publishDelete(id);
    void load();
  }

  async function applyTemplate(id: number) {
    setApplyingId(id);
    try {
      const res = await window.eyespro.templates.articleApply(id);
      if (res.ok && res.data?.id) {
        navigate(`/articles/${res.data.id}`);
      } else {
        setMsg({ ok: false, text: t('common.error') });
      }
    } finally {
      setApplyingId(null);
    }
  }

  function togglePubPlatform(p: string) {
    setPubForm((f) => {
      const n = new Set(f.platforms);
      if (n.has(p)) n.delete(p); else n.add(p);
      return { ...f, platforms: n };
    });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'article', label: t('templates.article') },
    { id: 'publish', label: t('templates.publish') },
  ];

  return (
    <Panel>
      <Toolbar>
        <div style={{ display: 'flex', gap: 6 }}>
          {tabs.map((item) => (
            <Btn
              key={item.id}
              size="sm"
              variant={tab === item.id ? 'primary' : 'ghost'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </Btn>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <Btn onClick={() => void load()}>↻</Btn>
        <Btn variant="primary" onClick={openCreate}>
          + {tab === 'article' ? t('templates.createArticle') : t('templates.createPublish')}
        </Btn>
      </Toolbar>

      {msg && (
        <div style={{ marginBottom: 12 }}>
          <Msg tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Msg>
        </div>
      )}

      {loading ? <Loading /> : tab === 'article' ? (
        articleRows.length === 0 ? (
          <Empty title={t('templates.empty')} desc={t('templates.emptyHint')} icon="📋" />
        ) : (
          <div className="ui-grid ui-grid--2">
            {articleRows.map((tpl) => (
              <Card key={tpl.id} title={tpl.name}>
                {tpl.category && <Badge tone="muted">{tpl.category}</Badge>}
                <p style={{ margin: '10px 0', fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
                  {tpl.title_template?.slice(0, 80) || tpl.content_template?.slice(0, 120) || '—'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn
                    size="sm"
                    variant="primary"
                    disabled={applyingId === tpl.id}
                    onClick={() => void applyTemplate(tpl.id)}
                  >
                    {applyingId === tpl.id ? '…' : t('templates.apply')}
                  </Btn>
                  <Btn size="sm" variant="danger" onClick={() => void removeArticle(tpl.id)}>
                    {t('common.delete')}
                  </Btn>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : publishRows.length === 0 ? (
        <Empty title={t('templates.empty')} desc={t('templates.emptyHint')} icon="📤" />
      ) : (
        <div className="ui-grid ui-grid--2">
          {publishRows.map((tpl) => {
            const plats = parsePlatforms(tpl.platforms);
            return (
              <Card key={tpl.id} title={tpl.name}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {plats.map((p) => <Badge key={p} tone="ok">{p}</Badge>)}
                </div>
                <Btn size="sm" variant="danger" onClick={() => void removePublish(tpl.id)}>
                  {t('common.delete')}
                </Btn>
              </Card>
            );
          })}
        </div>
      )}

      {showCreate && (
        <Modal
          title={tab === 'article' ? t('templates.createArticle') : t('templates.createPublish')}
          onClose={() => setShowCreate(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tab === 'article' ? (
              <>
                <Field label={t('templates.name')}>
                  <Input
                    value={artForm.name}
                    onChange={(e) => setArtForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field label={t('articles.colTitle')}>
                  <Input
                    value={artForm.title_template}
                    onChange={(e) => setArtForm((f) => ({ ...f, title_template: e.target.value }))}
                  />
                </Field>
                <Field label={t('articles.summary')}>
                  <Textarea
                    value={artForm.content_template}
                    onChange={(e) => setArtForm((f) => ({ ...f, content_template: e.target.value }))}
                    rows={5}
                    placeholder={t('templates.contentPlaceholder')}
                  />
                </Field>
                <Field label={t('sources.category')}>
                  <Input
                    value={artForm.category}
                    onChange={(e) => setArtForm((f) => ({ ...f, category: e.target.value }))}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('templates.name')}>
                  <Input
                    value={pubForm.name}
                    onChange={(e) => setPubForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                    {t('publish.platforms')}
                  </div>
                  {availablePlatforms.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--t3)' }}>
                      {t('templates.noPlatforms', { defaultValue: 'No platforms configured' })}
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {availablePlatforms.map((p) => (
                        <label
                          key={p}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={pubForm.platforms.has(p)}
                            onChange={() => togglePubPlatform(p)}
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setShowCreate(false)}>{t('common.cancel')}</Btn>
              <Btn variant="primary" disabled={submitting} onClick={() => void submitCreate()}>
                {submitting ? '…' : t('common.create')}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
