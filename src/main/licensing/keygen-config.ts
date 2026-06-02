/* ── keygen-config.ts ──────────────────────────────────────────────────────
   Keygen.sh API Configuration - Masar EyesPro
   Account: fc68c169-57fb-44f0-a17c-5cd5dc468881
──────────────────────────────────────────────────────────────────────────── */

export const KEYGEN_CONFIG = {
  ACCOUNT_ID: 'fc68c169-57fb-44f0-a17c-5cd5dc468881',
  PRODUCT_ID: '7176a1cf-5c80-47b1-b36a-6a0ad2fab3f1',
  POLICY_ID: 'f6977483-094e-4626-98bf-ce9a885a4497',
  VERIFY_KEY: 'a7982ac6fa0bcf137f5254209c5a25aac55a58841e409bc3f88c898421dae6fa',
  
  API_BASE_URL: 'https://api.keygen.sh/v1/accounts/fc68c169-57fb-44f0-a17c-5cd5dc468881',
  
  TRIAL_DAYS: 3,
  
  HEADERS: {
    'Content-Type': 'application/vnd.api+json',
    'Accept': 'application/vnd.api+json',
  }
} as const;

export type KeygenConfig = typeof KEYGEN_CONFIG;
