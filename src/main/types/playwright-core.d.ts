declare module 'playwright-core' {
  export interface PlaywrightResponse {
    headers: () => Record<string, string>;
    url: () => string;
    status: () => number;
    text: () => Promise<string>;
  }

  export const chromium: {
    launch: (opts?: Record<string, unknown>) => Promise<{
      newContext: (opts?: Record<string, unknown>) => Promise<{
        newPage: () => Promise<{
          goto: (url: string, opts?: Record<string, unknown>) => Promise<void>;
          evaluate: (fn: () => void) => Promise<void>;
          waitForTimeout: (ms: number) => Promise<void>;
          content: () => Promise<string>;
          waitForSelector: (selector: string, opts?: Record<string, unknown>) => Promise<void>;
          innerHTML: (selector: string) => Promise<string>;
          on: (event: string, cb: (response: PlaywrightResponse) => void) => void;
        }>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };
}
