import { createHmac, randomBytes } from 'node:crypto';

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sign(base: string, key: string): string {
  return createHmac('sha1', key).update(base).digest('base64');
}

export function oauthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };

  const allParams: Record<string, string> = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramStr = sortedKeys.map((k) => `${percentEncode(k)}=${percentEncode(allParams[k]!)}`).join('&');
  const baseStr = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramStr)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;
  oauthParams['oauth_signature'] = sign(baseStr, signingKey);

  const headerParts = Object.keys(oauthParams)
    .filter((k) => k.startsWith('oauth_'))
    .sort()
    .map((k) => `${k}="${percentEncode(oauthParams[k]!)}"`);

  return `OAuth ${headerParts.join(', ')}`;
}
