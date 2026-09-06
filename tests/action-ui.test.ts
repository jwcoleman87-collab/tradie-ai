import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ActionOutcome, ActionStatusChip } from '../components/action-status';
import { MessageCopy } from '../components/message-copy';
import { financeDisclosure } from '../lib/server/record-context';
import type { Action } from '../lib/contracts';

const sent: Action = {
  id: 'sample',
  workspace_id: 'a',
  conversation_id: 'c',
  connection_id: null,
  agent: 'social',
  action_type: 'facebook.publish',
  summary: 'Sample post',
  payload: {},
  status: 'completed',
  expires_at: '2099-09-05T00:00:00Z',
  created_at: '2026-09-05T00:00:00Z',
  executed_at: '2026-09-05T00:01:00Z',
  error_code: null,
  execution_result: { url: 'https://www.facebook.com/123_456' },
};
it('renders an explicit sent label, completion time and provider receipt', () => {
  const chip = renderToStaticMarkup(
    createElement(ActionStatusChip, { action: sent }),
  );
  expect(chip).toContain('action-status-green');
  expect(chip).toContain('Sent');
  const result = renderToStaticMarkup(
    createElement(ActionOutcome, {
      action: sent,
      timeZone: 'Australia/Sydney',
    }),
  );
  expect(result).toContain('dateTime="2026-09-05T00:01:00Z"');
  expect(result).toContain('href="https://www.facebook.com/123_456"');
  expect(result).toContain('Open live post');
});
it('renders Finance coverage beside the answer and preserves precise supplied calculations', () => {
  const disclosure = financeDisclosure({
    records: [],
    coverage: {
      returnedCount: 15,
      totalMatchingCount: 63,
      truncatedBodyCount: 2,
      selection: 'newest_active_matching_kinds',
      periodCoverage: 'not_established',
    },
  });
  const result = renderToStaticMarkup(
    createElement(MessageCopy, {
      text: `${disclosure}\n\nThe two supplied invoice charges add to AUD 450.`,
    }),
  );
  expect(result).toContain('Partial data');
  expect(result).toContain('15 of 63');
  expect(result).toContain('2 records were shortened');
  expect(result).toContain('AUD 450');
  expect(result).not.toContain('Any figures below must');
});
