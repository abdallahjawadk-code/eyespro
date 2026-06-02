import { describe, expect, it } from 'vitest';
import {
  parseGoogleOAuthCredentials,
  parseOAuthCallbackUrl,
} from '../src/main/services/youtube-oauth';

describe('parseGoogleOAuthCredentials', () => {
  it('parses installed (desktop) client JSON', () => {
    const json = JSON.stringify({
      installed: {
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: 'secret',
        redirect_uris: ['http://localhost'],
      },
    });
    const creds = parseGoogleOAuthCredentials(json);
    expect(creds.clientId).toBe('cid.apps.googleusercontent.com');
    expect(creds.clientSecret).toBe('secret');
    expect(creds.redirectUris).toContain('http://localhost');
  });

  it('parses web client JSON', () => {
    const json = JSON.stringify({
      web: {
        client_id: 'web-id',
        client_secret: 'web-secret',
      },
    });
    const creds = parseGoogleOAuthCredentials(json);
    expect(creds.clientId).toBe('web-id');
    expect(creds.clientSecret).toBe('web-secret');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseGoogleOAuthCredentials('not-json')).toThrow(/JSON/);
  });

  it('rejects missing client fields', () => {
    expect(() => parseGoogleOAuthCredentials('{}')).toThrow(/client_id/);
  });
});

describe('parseOAuthCallbackUrl', () => {
  it('extracts code and redirect URI from loopback callback', () => {
    const raw =
      'http://127.0.0.1:53212/oauth2callback?code=abc123&scope=youtube';
    const parsed = parseOAuthCallbackUrl(raw);
    expect(parsed.code).toBe('abc123');
    expect(parsed.redirectUri).toBe('http://127.0.0.1:53212/oauth2callback');
  });

  it('rejects non-loopback URLs', () => {
    expect(() => parseOAuthCallbackUrl('https://example.com/cb?code=x')).toThrow(/127.0.0.1/);
  });
});
