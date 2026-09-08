import { expect, it } from 'vitest';
import config from '../next.config';

it('protects pages from cross-origin framing without blocking resource or microphone use', async () => {
  const rules = await config.headers!();
  const global = rules.find((rule) => rule.source === '/:path*')!;
  const headers = Object.fromEntries(
    global.headers.map(({ key, value }) => [key, value]),
  );
  expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self'");
  expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
  expect(headers['X-Content-Type-Options']).toBe('nosniff');
  expect(headers['Permissions-Policy']).toBeUndefined();
  const api = rules.find((rule) => rule.source === '/api/:path*')!;
  expect(api.headers).toContainEqual({
    key: 'Referrer-Policy',
    value: 'no-referrer',
  });
});
