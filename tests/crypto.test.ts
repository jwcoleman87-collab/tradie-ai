import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt, sha256 } from '../lib/server/crypto';
beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});
describe('OAuth token encryption', () => {
  it('roundtrips without storing plaintext', async () => {
    const sealed = await encrypt('refresh-token-secret', 'workspace-a');
    expect(sealed).not.toContain('refresh-token-secret');
    expect(await decrypt(sealed, 'workspace-a')).toBe('refresh-token-secret');
  });
  it('binds ciphertext to the correct tenant', async () => {
    const sealed = await encrypt('secret', 'a');
    await expect(decrypt(sealed, 'b')).rejects.toThrow();
  });
  it('uses a fresh nonce', async () =>
    expect(await encrypt('secret', 'a')).not.toBe(
      await encrypt('secret', 'a'),
    ));
  it('rejects tampering', async () => {
    const sealed = await encrypt('secret', 'a');
    await expect(decrypt(sealed.replace('v1.', 'v2.'), 'a')).rejects.toThrow();
  });
  it('hashes deterministically', async () =>
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ));
});
