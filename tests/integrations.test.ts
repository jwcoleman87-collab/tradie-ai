import { afterEach, it, expect, vi } from 'vitest';
import { FacebookPayload, Proposal } from '../lib/contracts';
import { sendFacebookPost } from '../lib/server/facebook';
import { adsRead, graphRead } from '../lib/server/provider-http';
import { parseAdsReport } from '../lib/server/google-ads';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const post = {
  pageId: '12345',
  message: 'A completed job, with owner approval.',
  imageFileId: null,
  link: null,
};
it('accepts only social Page proposals and rejects credentials, mixed media and hidden scheduling', () => {
  expect(
    Proposal.safeParse({
      type: 'facebook.publish',
      agent: 'finance',
      summary: 'post',
      payload: post,
    }).success,
  ).toBe(false);
  expect(
    FacebookPayload.safeParse({ ...post, scheduledAt: 'tomorrow' }).success,
  ).toBe(false);
  expect(
    FacebookPayload.safeParse({
      ...post,
      link: 'https://secret:password@example.com',
    }).success,
  ).toBe(false);
  expect(
    FacebookPayload.safeParse({
      ...post,
      imageFileId: crypto.randomUUID(),
      link: 'https://example.com/product',
    }).success,
  ).toBe(false);
});
it('publishes the exact validated content and returns a receipt without credentials', async () => {
  vi.stubEnv('META_GRAPH_VERSION', 'v25.0');
  vi.stubEnv('META_APP_SECRET', 'test-secret');
  const mock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ id: '12345_999' }));
  const receipt = await sendFacebookPost('test-page-token', post);
  expect(receipt).toEqual({
    postId: '12345_999',
    url: 'https://www.facebook.com/12345_999',
    published: true,
  });
  const [url, options] = mock.mock.calls[0];
  expect(url).toBe('https://graph.facebook.com/v25.0/12345/feed');
  expect((options!.body as URLSearchParams).get('message')).toBe(post.message);
  expect(JSON.stringify(receipt)).not.toMatch(/token|secret/);
});
it('uploads one approved private photo with its exact caption', async () => {
  vi.stubEnv('META_GRAPH_VERSION', 'v25.0');
  vi.stubEnv('META_APP_SECRET', 'test-secret');
  const photo = { ...post, imageFileId: crypto.randomUUID() };
  const mock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ id: '999', post_id: '12345_1000' }));
  const receipt = await sendFacebookPost('test-page-token', photo, {
    bytes: new Uint8Array([255, 216, 255, 1]),
    filename: 'cargo-pack.jpg',
    mimeType: 'image/jpeg',
  });
  expect(receipt).toEqual({
    postId: '12345_1000',
    url: 'https://www.facebook.com/12345_1000',
    published: true,
  });
  const [url, options] = mock.mock.calls[0];
  expect(url).toBe('https://graph.facebook.com/v25.0/12345/photos');
  const body = options!.body as FormData;
  expect(body.get('caption')).toBe(photo.message);
  expect(body.get('published')).toBe('true');
  expect(body.get('source')).toBeInstanceOf(Blob);
});
for (const [status, data, code] of [
  [403, { error: { code: 200 } }, 'FACEBOOK_REJECTED'],
  [500, { error: { code: 2 } }, 'PUBLICATION_UNCERTAIN'],
  [200, { id: '888_99' }, 'PUBLICATION_UNCERTAIN'],
] as const)
  it(`classifies publication HTTP ${status} safely`, async () => {
    vi.stubEnv('META_GRAPH_VERSION', 'v25.0');
    vi.stubEnv('META_APP_SECRET', 'test-secret');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(data, { status }),
    );
    await expect(sendFacebookPost('test-token', post)).rejects.toMatchObject({
      code,
    });
  });
it('blocks writes and arbitrary URLs through read-only helpers before any network call', async () => {
  const mock = vi.spyOn(globalThis, 'fetch');
  await expect(
    adsRead('secret', 'customers/1234567890/campaigns:mutate', 'SELECT test'),
  ).rejects.toThrow();
  await expect(
    graphRead('https://attacker.example/', 'secret'),
  ).rejects.toThrow();
  expect(mock).not.toHaveBeenCalled();
});
it('retains large integer metrics and distinguishes missing conversions from zero', () => {
  const account = {
    id: '1234567890',
    name: 'Business',
    currency: 'AUD',
    timeZone: 'Australia/Sydney',
  };
  const r = parseAdsReport(
    {
      results: [
        {
          campaign: { id: '1', name: 'Campaign', status: 'ENABLED' },
          metrics: { costMicros: '90071992547409930000', clicks: '10' },
        },
        {
          campaign: { id: '2', name: 'Empty', status: 'PAUSED' },
          metrics: { conversions: 0 },
        },
      ],
    },
    account,
  );
  expect(r.campaigns[0].costMicros).toBe('90071992547409930000');
  expect(r.campaigns[0].conversions).toBeNull();
  expect(r.campaigns[1].conversions).toBe(0);
  expect(r.account.currency).toBe('AUD');
});
