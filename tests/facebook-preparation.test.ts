import { expect, it, vi } from 'vitest';
import type { ConnectionInfo } from '../lib/integrations';
import { runTeam } from '../lib/server/ai';

const page: ConnectionInfo = {
  provider: 'facebook',
  configured: true,
  connectionId: '10000000-0000-4000-8000-000000000001',
  status: 'connected',
  externalId: '12345',
  displayName: 'Test Page',
  verifiedAt: '2026-09-05T00:00:00Z',
  lastErrorCode: null,
  lastErrorAt: null,
  capabilities: ['facebook.publish'],
};
const proposal = {
  agent: 'social',
  type: 'facebook.publish',
  summary: 'Review the Facebook post',
  payload: { pageId: '12345', message: 'Bookings are available next week.' },
};
function prepare(integrations: ConnectionInfo[], pageId = '12345') {
  const structured = vi
    .fn()
    .mockResolvedValueOnce({
      agents: ['social'],
      reason: 'Facebook post',
      calendarContext: false,
      webSearch: false,
      searchQuery: null,
    })
    .mockResolvedValueOnce({
      reply: 'Review the exact post before publishing.',
      proposals: [{ ...proposal, payload: { ...proposal.payload, pageId } }],
      escalation: 'none',
    });
  return {
    structured,
    result: runTeam(
      { model: 'fixture', structured },
      {
        history: [
          { role: 'user', content: 'Prepare a Facebook post for my review.' },
        ],
        timeZone: 'Australia/Sydney',
        integrations,
      },
    ),
  };
}

it.each([true, false])(
  'prepares the exact publishing proposal when execution enabled=%s',
  async (enabled) => {
    const connection = {
      ...page,
      capabilities: enabled ? ['facebook.publish'] : [],
      publishingUnavailableReason: enabled
        ? null
        : ('operator_disabled' as const),
    };
    const { structured, result } = prepare([connection]);
    expect((await result).proposals).toEqual([proposal]);
    const context = JSON.parse(structured.mock.calls[1][2][0].content);
    expect(context.verifiedConnections[0]).toMatchObject({
      externalId: '12345',
      facebookPreparationAvailable: true,
      publishingUnavailableReason: enabled ? null : 'operator_disabled',
    });
    if (!enabled)
      expect(context.verifiedConnections[0].publishingBlockReason).toContain(
        'switched off in Workbench',
      );
    const instructions = structured.mock.calls[1][1];
    expect(instructions).toContain(
      'Do not silently replace a publication request with a private draft',
    );
    expect(instructions).toContain(
      'Never claim an action has happened without an execution receipt',
    );
    expect(instructions).toContain(
      'Do not replace, retry or duplicate pending/approved/completed work',
    );
  },
);

it.each(
  (
    [
      [],
      [{ ...page, status: 'not_connected' }],
      [{ ...page, configured: false }],
      [{ ...page, connectionId: null }],
      [{ ...page, lastErrorCode: 'FACEBOOK_PERMISSIONS_REQUIRED' }],
      [{ ...page, lastErrorCode: 'FACEBOOK_CHECK_FAILED' }],
    ] as ConnectionInfo[][]
  ).map((integrations) => ({ integrations })),
)(
  'rejects a model publication proposal without eligible Page access %#',
  async ({ integrations }) => {
    await expect(prepare(integrations).result).rejects.toMatchObject({
      code: 'FACEBOOK_NOT_CONNECTED',
    });
  },
);

it('rejects a model-supplied Page ID different from the selected Page', async () => {
  await expect(prepare([page], '99999').result).rejects.toMatchObject({
    code: 'FACEBOOK_NOT_CONNECTED',
  });
});
