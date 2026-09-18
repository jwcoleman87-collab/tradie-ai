import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatReply } from '../components/chat-reply';
import { appendChatRequest, chatReplyActions } from '../lib/chat-reply-actions';

const render = (text: string, actions = false) =>
  renderToStaticMarkup(
    createElement(ChatReply, {
      text,
      showActions: actions,
      actionsEnabled: actions,
      onChoosePrompt: () => true,
    }),
  );

describe('branded Chat replies', () => {
  it('presents actual supplied amounts together with their conditions', () => {
    const html = render(
      '## Rates\n- Minimum charge: AUD 710 inc GST; travel extra.\n- Hourly on-site rate: AUD 195 inc GST.\n- After-hours rate: 1.75× hourly after 19:00.\n- Quote limit: Above AUD 4,800 needs owner approval.',
    );
    expect(html).toContain('chat-reply-metrics');
    for (const value of [
      'AUD 710',
      'inc GST; travel extra.',
      'AUD 195',
      '1.75×',
      'after 19:00.',
      'AUD 4,800',
      'owner approval',
    ])
      expect(html).toContain(value);
    expect(html).not.toContain('650');
    expect(html).not.toContain('185');
  });

  it('never infers a GreenVac rate or a successful connection from workspace wording', () => {
    const html = render(
      '## Business profile\n- Services: Hydro excavation\n\n## Connections\n- Google Calendar: not connected / access must be restored.\n- Facebook Page: status unknown; check the connection.',
    );
    expect(html).toContain('data-state="disconnected"');
    expect(html).not.toContain('data-state="connected"');
    expect(html).toContain('status unknown; check the connection.');
    expect(html).not.toContain('650');
    expect(html).not.toContain('greenvac.png');
  });

  it('keeps finance coverage visible and preserves verified sources once', () => {
    const html = render(
      'Data coverage: 2 of 63 records; not a complete monthly total.\n\n## Available figures\nOnly a subtotal is available. [Reference](https://example.gov.au/guide)\n\nSources — live web research (2026-09-14T00:00:00Z):\n- [Official guidance](https://example.gov.au/source)',
    );
    expect(html).toContain('Partial data');
    expect(html).toContain('2 of 63 records; not a complete monthly total.');
    expect(html).toContain('href="https://example.gov.au/guide"');
    expect(html.match(/href="https:\/\/example.gov.au\/source"/g)).toHaveLength(
      1,
    );
    expect(html).toContain('Sources checked');
  });

  it('offers eight editable requests only when explicitly enabled for this reply', () => {
    const text = '## Business profile\n- Name: Example business';
    const html = render(text, true);
    expect(html.match(/type="button"/g)).toHaveLength(8);
    expect(html).toContain('They do not book, save or publish.');
    expect(html).not.toContain('Show full brief');
    expect(render(text)).not.toContain('Prepare Facebook post');
    expect(html).not.toContain('<form');
  });

  it('preserves signed values, raw unrecognised content and safe links', () => {
    const html = render(
      '## Rates\n- Minimum charge: -$50 correction, not a quote.\n\nKeep <script>alert(1)</script> as text. [Unsafe](javascript:alert)',
    );
    expect(html).toContain('-$50 correction, not a quote.');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });

  it('does not promote a qualified or historical connection claim to a success badge', () => {
    const html = render(
      '## Connections\n- Google Calendar: Connected previously; authorization has expired.\n- Facebook Page: Connected? Not verified.',
    );
    expect(html).not.toContain('data-state="connected"');
    expect(html).toContain('authorization has expired.');
    expect(html).toContain('Not verified.');
  });
});

describe('editable request buttons', () => {
  it('keeps the existing draft and avoids appending the same request twice', () => {
    const prompt = chatReplyActions[1].actions[0].prompt;
    expect(appendChatRequest('', prompt)).toBe(prompt);
    const next = appendChatRequest('Keep these customer details.', prompt);
    expect(next).toBe(`Keep these customer details.\n\n${prompt}`);
    expect(appendChatRequest(next, prompt)).toBe(next);
    const fullDraft = 'x'.repeat(11950);
    expect(appendChatRequest(fullDraft, prompt)).toBe(fullDraft);
  });

  it('uses generic preparation requests without stored customer facts or invented amounts', () => {
    const actions = chatReplyActions.flatMap<{ id: string; prompt: string }>(
      (group) => group.actions,
    );
    expect(new Set(actions.map((action) => action.id)).size).toBe(8);
    expect(
      actions.every(
        (action) => !/GreenVac|John|\$\d|2026-|5c00989e/.test(action.prompt),
      ),
    ).toBe(true);
    expect(actions.find((action) => action.id === 'booking')?.prompt).toContain(
      'Do not book until I approve',
    );
    expect(
      actions.find((action) => action.id === 'facebook')?.prompt,
    ).toContain('Do not publish until I approve');
  });
});
