import { required } from './config';
import { AppError } from './errors';
export const base64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64');
export const randomSecret = () => crypto.randomUUID() + crypto.randomUUID();
export async function sha256(value: string) {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  ).toString('hex');
}
async function key() {
  const raw = Buffer.from(required('TOKEN_ENCRYPTION_KEY'), 'base64');
  if (raw.length !== 32) throw new AppError('ENCRYPTION_CONFIG_INVALID', 503);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function encrypt(value: string, workspaceId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(workspaceId),
    },
    await key(),
    new TextEncoder().encode(value),
  );
  return `v1.${base64(iv)}.${base64(new Uint8Array(cipher))}`;
}
export async function decrypt(value: string, workspaceId: string) {
  try {
    const [version, iv, cipher] = value.split('.');
    if (version !== 'v1') throw Error();
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: Buffer.from(iv, 'base64'),
          additionalData: new TextEncoder().encode(workspaceId),
        },
        await key(),
        Buffer.from(cipher, 'base64'),
      ),
    );
  } catch {
    throw new AppError(
      'RECONNECT_REQUIRED',
      409,
      'Please reconnect Google Calendar.',
    );
  }
}
