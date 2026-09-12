import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FallbackProvider } from '../lib/server/ai-provider';
import type { ModelProvider } from '../lib/server/ai';

class CapturingProvider implements ModelProvider {
  readonly name = 'openai' as const;
  model = 'test-model';
  captured: unknown[] | null = null;
  async structured<T>(schema: z.ZodType<T>, _instructions: string, input: unknown[]) {
    this.captured = input;
    return schema.parse({ ok: true });
  }
}

describe('security hardening', () => {
  it('never forwards raw PDF bytes or input_file blocks to an AI provider', async () => {
    const inner = new CapturingProvider();
    const provider = new FallbackProvider([inner]);
    const schema = z.object({ ok: z.literal(true) });

    await provider.structured(schema, 'test', [
      {
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: 'invoice.pdf',
            file_data: 'data:application/pdf;base64,VERY_SECRET_PDF_BYTES',
          },
        ],
      },
    ]);

    const sent = JSON.stringify(inner.captured);
    expect(sent).not.toContain('VERY_SECRET_PDF_BYTES');
    expect(sent).not.toContain('file_data');
    expect(sent).not.toContain('input_file');
    expect(sent).toContain('withheld the raw PDF bytes');
  });
});
