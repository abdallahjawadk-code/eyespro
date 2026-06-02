import { net } from 'electron';

// ─── Keygen.sh configuration ──────────────────────────────────────────────────
// Account ID is public (safe to embed in client)
const ACCOUNT = 'fc68c169-57fb-44f0-a17c-5cd5dc468881';
const BASE     = `https://api.keygen.sh/v1/accounts/${ACCOUNT}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivateResult {
  ok: boolean;
  token?: string;          // machine token for later deactivation
  licenseId?: string;
  error?: string;
  seats_used?: number;
  seats_total?: number;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

// Keygen validation codes that mean "valid on this machine"
const VALID_CODES = new Set(['VALID', 'FINGERPRINT_SCOPE_MISMATCH']);

// ─── HTTP helper ──────────────────────────────────────────────────────────────

interface RequestOptions {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  licenseKey?: string;  // used as Bearer for machine operations
}

function request<T>(opts: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const url = `${BASE}${opts.path}`;
    const req = net.request({ method: opts.method, url });
    req.setHeader('Content-Type', 'application/vnd.api+json');
    req.setHeader('Accept', 'application/vnd.api+json');
    req.setHeader('User-Agent', 'EyesPro/1.0');
    if (opts.licenseKey) req.setHeader('Authorization', `License ${opts.licenseKey}`);

    const chunks: Buffer[] = [];
    req.on('response', res => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString()) as T); }
        catch { reject(new Error('Invalid server response')); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a license key against this machine fingerprint.
 * Keygen returns meta.code = 'VALID' | 'NO_MACHINES' | 'TOO_MANY_MACHINES' | ...
 */
export async function activateLicense(licenseKey: string, machineId: string): Promise<ActivateResult> {
  // Step 1 — validate the key
  interface KeygenValidate {
    meta: { valid: boolean; code: string; detail: string };
    data: { id: string; attributes: { maxMachines: number } } | null;
    errors?: { title: string; detail: string }[];
  }

  let validation: KeygenValidate;
  try {
    validation = await request<KeygenValidate>({
      method: 'POST',
      path: '/licenses/actions/validate-key',
      body: {
        meta: {
          key: licenseKey,
          scope: { fingerprint: machineId }
        }
      }
    });
  } catch {
    return { ok: false, error: 'تعذّر الاتصال بخادم التراخيص' };
  }

  if (validation.errors?.length) {
    return { ok: false, error: validation.errors[0]?.detail ?? 'خطأ في التحقق' };
  }

  const code      = validation.meta?.code;
  const licenseId = validation.data?.id;

  // Already activated on this machine
  if (validation.meta?.valid && VALID_CODES.has(code)) {
    return { ok: true, licenseId };
  }

  // Too many machines
  if (code === 'TOO_MANY_MACHINES' || code === 'TOO_MANY_CORES') {
    const max = validation.data?.attributes?.maxMachines ?? 5;
    return { ok: false, error: `وصلت للحد الأقصى من الأجهزة (${max}). يُرجى إلغاء تفعيل جهاز آخر.` };
  }

  // License not found / expired / suspended
  if (code === 'NOT_FOUND')  return { ok: false, error: 'السيريال غير موجود' };
  if (code === 'EXPIRED')    return { ok: false, error: 'انتهت صلاحية الترخيص' };
  if (code === 'SUSPENDED')  return { ok: false, error: 'تم تعليق هذا الترخيص' };
  if (code === 'REVOKED')    return { ok: false, error: 'تم إلغاء هذا الترخيص' };

  // code === 'NO_MACHINES' or similar → need to activate this machine
  if (!licenseId) return { ok: false, error: 'لم يتم التعرف على الترخيص' };

  // Step 2 — activate this machine
  interface KeygenMachine {
    data?: { id: string; attributes: { fingerprint: string } };
    errors?: { title: string; detail: string; code?: string }[];
  }

  let machineRes: KeygenMachine;
  try {
    machineRes = await request<KeygenMachine>({
      method: 'POST',
      path: '/machines',
      licenseKey,
      body: {
        data: {
          type: 'machines',
          attributes: {
            fingerprint: machineId,
            name: `EyesPro — Windows`
          },
          relationships: {
            license: { data: { type: 'licenses', id: licenseId } }
          }
        }
      }
    });
  } catch {
    return { ok: false, error: 'تعذّر تسجيل الجهاز' };
  }

  if (machineRes.errors?.length) {
    const err = machineRes.errors[0];
    if (err?.code === 'MACHINE_LIMIT_EXCEEDED') {
      return { ok: false, error: 'وصلت للحد الأقصى من الأجهزة' };
    }
    return { ok: false, error: err?.detail ?? 'فشل تسجيل الجهاز' };
  }

  return { ok: true, licenseId, token: machineRes.data?.id };
}

/**
 * Re-validate that the stored license is still active on this machine.
 */
export async function verifyLicense(licenseKey: string, machineId: string): Promise<VerifyResult> {
  try {
    interface KeygenValidate { meta: { valid: boolean; code: string } }
    const res = await request<KeygenValidate>({
      method: 'POST',
      path: '/licenses/actions/validate-key',
      body: { meta: { key: licenseKey, scope: { fingerprint: machineId } } }
    });
    if (res.meta?.valid) return { ok: true };
    const code = res.meta?.code;
    if (code === 'EXPIRED')   return { ok: false, error: 'انتهت صلاحية الترخيص' };
    if (code === 'SUSPENDED') return { ok: false, error: 'تم تعليق الترخيص' };
    if (code === 'REVOKED')   return { ok: false, error: 'تم إلغاء الترخيص' };
    return { ok: false, error: code };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

/**
 * Deactivate (delete) this machine from Keygen — frees a seat.
 * machineToken = the machine ID returned from activation.
 */
export async function deactivateLicense(licenseKey: string, machineToken: string): Promise<VerifyResult> {
  try {
    await request({
      method: 'DELETE',
      path: `/machines/${machineToken}`,
      licenseKey
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'تعذّر إلغاء التفعيل' };
  }
}
