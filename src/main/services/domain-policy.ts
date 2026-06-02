import { getDb } from '../db/database';
import { sanitizeString } from '../security/sanitize';

export type FetchMode = 'feed_only' | 'smart' | 'always' | 'browser';

export interface DomainPolicyRow {
  host: string;
  use_browser: number;
  respect_robots: number;
  max_per_hour: number;
  fetch_mode: string;
  clean_rules_json: string | null;
  paywall_mode: string;
  notes: string | null;
}

export function getDomainPolicy(host: string): DomainPolicyRow | null {
  const h = host.toLowerCase().replace(/^www\./, '');
  return (
    (getDb().prepare(`SELECT * FROM domain_policies WHERE host=?`).get(h) as DomainPolicyRow | undefined) ??
    (getDb().prepare(`SELECT * FROM domain_policies WHERE host=?`).get(`www.${h}`) as DomainPolicyRow | undefined) ??
    null
  );
}

export function listDomainPolicies(): DomainPolicyRow[] {
  return getDb().prepare(`SELECT * FROM domain_policies ORDER BY host`).all() as DomainPolicyRow[];
}

export function upsertDomainPolicy(data: Partial<DomainPolicyRow> & { host: string }): void {
  const host = sanitizeString(data.host, 253).toLowerCase().replace(/^www\./, '');
  getDb()
    .prepare(
      `INSERT INTO domain_policies (host, use_browser, respect_robots, max_per_hour, fetch_mode, clean_rules_json, paywall_mode, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(host) DO UPDATE SET
         use_browser=excluded.use_browser,
         respect_robots=excluded.respect_robots,
         max_per_hour=excluded.max_per_hour,
         fetch_mode=excluded.fetch_mode,
         clean_rules_json=excluded.clean_rules_json,
         paywall_mode=excluded.paywall_mode,
         notes=excluded.notes,
         updated_at=datetime('now')`
    )
    .run(
      host,
      data.use_browser ?? 0,
      data.respect_robots ?? 1,
      data.max_per_hour ?? 0,
      sanitizeString(data.fetch_mode ?? 'smart', 32),
      data.clean_rules_json ? sanitizeString(data.clean_rules_json, 8000) : null,
      sanitizeString(data.paywall_mode ?? 'none', 32),
      data.notes ? sanitizeString(data.notes, 500) : null
    );
}

export function deleteDomainPolicy(host: string): boolean {
  const r = getDb().prepare(`DELETE FROM domain_policies WHERE host=?`).run(host.toLowerCase());
  return r.changes > 0;
}

export function effectiveFetchMode(host: string, sourceMode?: string | null): FetchMode {
  const policy = getDomainPolicy(host);
  const mode = (policy?.fetch_mode || sourceMode || 'smart') as FetchMode;
  if (['feed_only', 'smart', 'always', 'browser'].includes(mode)) return mode;
  return 'smart';
}

export function shouldForceBrowser(host: string): boolean {
  const policy = getDomainPolicy(host);
  return policy?.use_browser === 1;
}
