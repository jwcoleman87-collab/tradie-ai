import { describe, it, expect } from 'vitest';
const origin = process.env.TEST_APP_ORIGIN,
  tokenA = process.env.TEST_USER_A_TOKEN,
  tokenB = process.env.TEST_USER_B_TOKEN;
describe.skipIf(!origin || !tokenA || !tokenB)(
  'live staging isolation (read-only)',
  () => {
    it('requires authentication', async () =>
      expect((await fetch(`${origin}/api/state`)).status).toBe(401));
    it('rejects a different authenticated customer workspace', async () => {
      const a = await fetch(`${origin}/api/state`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(a.ok).toBe(true);
      const data = (await a.json()) as { workspace: { id: string } };
      const b = await fetch(
        `${origin}/api/state?workspaceId=${data.workspace.id}`,
        { headers: { Authorization: `Bearer ${tokenB}` } },
      );
      expect(b.status).toBe(403);
    });
  },
);
