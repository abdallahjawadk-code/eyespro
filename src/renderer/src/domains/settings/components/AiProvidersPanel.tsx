import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROVIDER_DEFAULT_MODELS } from '../hooks/useAiSettings';

export type AiProviderTestState = {
  loading: boolean;
  ok?: boolean;
  msg?: string;
  latencyMs?: number;
};

interface AiProviderDef {
  id: string;
  icon: string;
  name: string;
  color: string;
  descKey: string;
  fields: { key: string; labelKey: string; hintKey?: string }[];
  docsUrl: string;
}

const CLOUD_PROVIDERS: AiProviderDef[] = [
  {
    id: 'gemini',
    icon: '🔷',
    name: 'Google Gemini',
    color: '#4285f4',
    descKey: 'aiProv.geminiDesc',
    docsUrl: 'https://aistudio.google.com/apikey',
    fields: [{ key: 'gemini_api_key', labelKey: 'settings.geminiKey', hintKey: 'aiProv.geminiHint' }],
  },
  {
    id: 'openai',
    icon: '🟢',
    name: 'OpenAI',
    color: '#10a37f',
    descKey: 'aiProv.openaiDesc',
    docsUrl: 'https://platform.openai.com/api-keys',
    fields: [{ key: 'openai_api_key', labelKey: 'aiProv.openaiKey', hintKey: 'aiProv.openaiHint' }],
  },
  {
    id: 'groq',
    icon: '🔶',
    name: 'Groq',
    color: '#f55036',
    descKey: 'aiProv.groqDesc',
    docsUrl: 'https://console.groq.com/keys',
    fields: [{ key: 'groq_api_key', labelKey: 'aiProv.groqKey', hintKey: 'aiProv.groqHint' }],
  },
  {
    id: 'anthropic',
    icon: '🟠',
    name: 'Anthropic Claude',
    color: '#d97706',
    descKey: 'aiProv.anthropicDesc',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    fields: [{ key: 'anthropic_api_key', labelKey: 'aiProv.anthropicKey', hintKey: 'aiProv.anthropicHint' }],
  },
];

function providerConfigured(p: AiProviderDef, vals: Record<string, string>): boolean {
  return p.fields.every((f) => (vals[f.key] ?? '').trim().length > 0);
}

function providerReady(p: AiProviderDef, vals: Record<string, string>): boolean {
  const primary = p.fields[0];
  return primary ? (vals[primary.key] ?? '').trim().length >= 8 : false;
}

function PwFieldInline({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="sp-field sp-field-full">
      <label>{label}</label>
      <div className="sp-pw-wrap">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={label}
          dir="ltr"
          autoComplete="off"
        />
        <button type="button" className="sp-pw-eye" onClick={() => setShow((s) => !s)} tabIndex={-1}>
          {show ? '🙈' : '👁'}
        </button>
      </div>
      {hint && <div className="sp-field-hint">💡 {hint}</div>}
    </div>
  );
}

export function AiProvidersPanel({
  integrations,
  expanded,
  tests,
  savingProvider,
  activeProvider,
  activeModel,
  onToggle,
  onFieldChange,
  onSave,
  onTest,
  onSetActive,
}: {
  integrations: Record<string, string>;
  expanded: Record<string, boolean>;
  tests: Record<string, AiProviderTestState>;
  savingProvider: string | null;
  activeProvider: string;
  activeModel?: string;
  onToggle: (id: string) => void;
  onFieldChange: (key: string, val: string) => void;
  onSave: (providerId: string) => void;
  onTest: (providerId: string) => void;
  onSetActive: (providerId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <p className="sp-plat-intro">{t('aiProv.intro')}</p>

      {/* Active provider summary + master on/off */}
      {activeProvider === 'off' ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
          background: 'var(--bg2)', borderRadius: 8, marginBottom: 12,
          border: '1px solid var(--warn)', fontSize: '0.85rem',
        }}>
          <span style={{ color: 'var(--warn)', fontWeight: 700 }}>⊘ {t('aiProv.disabled', { defaultValue: 'AI is turned off' })}</span>
          <span style={{ marginInlineStart: 'auto', color: 'var(--t2)', fontSize: '0.78rem' }}>
            {t('aiProv.disabledHint', { defaultValue: 'Pick a provider below to enable it.' })}
          </span>
        </div>
      ) : activeProvider && activeProvider !== 'unconfigured' ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
          background: 'var(--bg2)', borderRadius: 8, marginBottom: 12,
          border: '1px solid var(--border)', fontSize: '0.85rem',
        }}>
          <span style={{ color: 'var(--ok)', fontWeight: 700 }}>● {t('aiProv.active')}</span>
          <span style={{ color: 'var(--t1)', fontWeight: 600, textTransform: 'capitalize' }}>{activeProvider}</span>
          {activeModel && (
            <span style={{ color: 'var(--t2)', fontFamily: 'monospace', fontSize: '0.78rem' }}>
              · {activeModel}
            </span>
          )}
          <button
            type="button"
            onClick={() => onSetActive('off')}
            style={{
              marginInlineStart: 'auto', padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--t2)', fontSize: '0.75rem',
            }}
          >
            {t('aiProv.disable', { defaultValue: 'Turn off AI' })}
          </button>
        </div>
      ) : null}

      {/* Multi-provider fallback hint */}
      <p style={{ fontSize: '0.78rem', color: 'var(--t2)', margin: '0 0 14px', lineHeight: 1.6 }}>
        💡 {t('aiProv.fallbackHint', { defaultValue: 'You can configure several providers — if one fails or is blocked, the app automatically falls back to the next one.' })}
      </p>

      <div className="sp-plat-grid">
        {CLOUD_PROVIDERS.map((plat) => {
          const configured = providerConfigured(plat, integrations);
          const ready = providerReady(plat, integrations);
          const open = !!expanded[plat.id];
          const ts = tests[plat.id];
          const busy = savingProvider === plat.id;
          const isActive = activeProvider === plat.id;
          const defaultModel = PROVIDER_DEFAULT_MODELS[plat.id] ?? '';

          return (
            <div
              key={plat.id}
              className={`sp-plat-card${configured ? ' sp-plat-configured' : ''}${isActive ? ' ai-prov-active' : ''}`}
              style={open ? { borderColor: `${plat.color}66` } : undefined}
            >
              <div
                className="sp-plat-hdr"
                role="button"
                tabIndex={0}
                onClick={() => onToggle(plat.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onToggle(plat.id);
                }}
              >
                <span className="sp-plat-hdr-accent" style={{ background: plat.color }} />
                <span className="sp-plat-hdr-ico">{plat.icon}</span>
                <span className="sp-plat-hdr-name">{plat.name}</span>
                {isActive && (
                  <span className="sp-plat-hdr-status sp-plat-ok" style={{ marginInlineEnd: 4 }}>
                    ★ {t('aiProv.active')}
                  </span>
                )}
                <span className={`sp-plat-hdr-status ${configured ? 'sp-plat-ok' : 'sp-plat-empty'}`}>
                  {configured ? (ready ? '● ' + t('aiProv.ready') : '◐ ' + t('aiProv.partial')) : '○ ' + t('aiProv.empty')}
                </span>
                <a
                  className="btn btn-ghost btn-xs sp-plat-guide-btn"
                  href={plat.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  ↗ {t('aiProv.getKey')}
                </a>
                <span className={`sp-plat-hdr-arrow${open ? ' open' : ''}`}>▼</span>
              </div>

              {open && (
                <div className="sp-plat-body">
                  <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--t2)', lineHeight: 1.55 }}>
                    {t(plat.descKey)}
                  </p>
                  <div className="sp-plat-fields" style={{ gridTemplateColumns: '1fr' }}>
                    {plat.fields.map((f) => (
                      <PwFieldInline
                        key={f.key}
                        label={t(f.labelKey)}
                        value={integrations[f.key] || ''}
                        onChange={(v) => onFieldChange(f.key, v)}
                        hint={f.hintKey ? t(f.hintKey) : undefined}
                      />
                    ))}
                  </div>

                  {/* Auto model badge — informational only */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    background: 'var(--bg3, var(--bg2))', borderRadius: 6, marginTop: 10,
                    fontSize: '0.8rem', color: 'var(--t2)',
                  }}>
                    <span>🧠</span>
                    <span>{t('aiProv.autoModel') || 'الموديل التلقائي'}:</span>
                    <code style={{ color: 'var(--t1)', fontWeight: 600 }}>{defaultModel}</code>
                  </div>

                  <div className="sp-plat-footer">
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm${isActive ? ' sp-on' : ''}`}
                      disabled={!configured || busy}
                      onClick={() => onSetActive(plat.id)}
                      title={t('aiProv.useAsDefault')}
                    >
                      {isActive ? '✓ ' + t('aiProv.defaultProvider') : '☆ ' + t('aiProv.setDefault')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || !!ts?.loading}
                      onClick={() => onSave(plat.id)}
                    >
                      {busy ? '…' : '💾 ' + t('common.save')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ background: plat.color, color: '#fff', border: 'none', minWidth: 130 }}
                      disabled={!ready || busy || !!ts?.loading}
                      onClick={() => onTest(plat.id)}
                    >
                      {ts?.loading ? '… ' + t('aiProv.testing') : '🔌 ' + t('aiProv.testConnection')}
                    </button>
                    {ts && !ts.loading && (
                      <span className={`sp-test-badge ${ts.ok ? 'sp-test-ok' : 'sp-test-err'}`}>
                        {ts.ok ? '✓' : '✕'} {ts.msg}
                        {ts.latencyMs != null && ts.ok ? ` · ${ts.latencyMs}ms` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
