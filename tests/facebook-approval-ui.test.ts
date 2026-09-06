import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionCard } from '../components/workspace';
import { FacebookPostEditor } from '../components/facebook-post-editor';
import type { Action } from '../lib/contracts';
import type { ConnectionInfo } from '../lib/integrations';

const action: Action = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: 'workspace',
  conversation_id: 'conversation',
  connection_id: 'connection',
  agent: 'social',
  action_type: 'facebook.publish',
  summary: 'GreenVac announcement',
  payload: {
    pageId: '425519427313504',
    message: 'Our exact announcement.',
    link: null,
    imageFileId: null,
  },
  status: 'waiting_approval',
  expires_at: '2099-09-06T12:00:00Z',
  created_at: '2026-09-06T12:00:00Z',
  error_code: null,
  execution_result: null,
};
const connection: ConnectionInfo = {
  provider: 'facebook',
  configured: true,
  status: 'connected',
  connectionId: 'connection',
  externalId: '425519427313504',
  displayName: 'GreenVac',
  verifiedAt: '2026-09-06T12:00:00Z',
  lastErrorCode: null,
  lastErrorAt: null,
  capabilities: ['facebook.publish'],
};
const render = (a = action, c: ConnectionInfo | undefined = connection) =>
  renderToStaticMarkup(
    createElement(ActionCard, {
      action: a,
      facebookConnection: c,
      businessName: 'GreenVac',
      timeZone: 'Australia/Sydney',
      token: '',
      disabled: false,
      connectionChanged: false,
      onDecision() {},
      onRetry() {},
      onReconnect() {},
      onReplace() {},
      onCancel() {},
      async onRevise() {},
    }),
  );
const button = (html: string, name: string) =>
  [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
    .find((value) => value.replace(/<[^>]*>/g, '').trim() === name);

describe('Facebook approval controls', () => {
  it('shows exact post, separate Edit, and enabled Approve for a publishable Page', () => {
    const html = render();
    expect(html).toContain('Our exact announcement.');
    expect(html).toContain('Approve publishes this exact post');
    expect(button(html, 'Edit')).toBeDefined();
    expect(button(html, 'Edit')).not.toMatch(/\sdisabled=/);
    expect(button(html, 'Approve')).toBeDefined();
    expect(button(html, 'Approve')).not.toMatch(/\sdisabled=/);
  });
  it('keeps the publish intent visible and disables approval when the operator switch is off', () => {
    const html = render(action, {
      ...connection,
      capabilities: [],
      publishingUnavailableReason: 'operator_disabled',
    });
    expect(html).toContain('publishing');
    expect(html).toContain('approval is unavailable');
    expect(button(html, 'Approve')).toMatch(/\sdisabled=/);
    expect(html).not.toContain('Save draft');
    expect(html).not.toContain('Meta approval');
  });
  it('labels private saves by their actual effect without offering publishing approval', () => {
    const html = render({
      ...action,
      action_type: 'draft.save',
      connection_id: null,
      payload: {
        kind: 'social',
        title: 'Announcement draft',
        body: 'Our exact announcement.',
      },
    });
    expect(html).toContain('Save draft');
    expect(button(html, 'Approve')).toBeUndefined();
    expect(button(html, 'Edit')).toBeUndefined();
  });
  it('offers no approval inside the editor and preserves the selected image', () => {
    const html = renderToStaticMarkup(
      createElement(FacebookPostEditor, {
        payload: {
          ...action.payload,
          imageFileId: '22222222-2222-4222-8222-222222222222',
        },
        disabled: false,
        async onSave() {},
        onCancel() {},
      }),
    );
    expect(html).toContain('Save changes');
    expect(html).toContain('Cancel edit');
    expect(html).not.toContain('Link (optional)');
    expect(button(html, 'Approve')).toBeUndefined();
  });
});
