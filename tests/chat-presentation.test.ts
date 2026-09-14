import { describe, expect, it } from 'vitest';
import { parseChatSections } from '../lib/chat-presentation';

describe('chat presentation', () => {
  it('keeps ordinary answers, qualifications and links without inventing a brief', () => {
    const text =
      'Yes, subject to owner approval. See [the source](https://example.test/a-b?q=-50).';
    expect(parseChatSections(text)).toEqual([
      {
        id: 'section-1',
        title: 'Answer',
        kind: 'answer',
        blocks: [{ kind: 'text', text }],
      },
    ]);
    expect(parseChatSections(' \r\n ')).toEqual([]);
  });

  it('recognizes explicit heading forms and retains unfamiliar headings', () => {
    expect(
      parseChatSections(
        '## Business profile\n- Name: Example\n\n**Connections:**\n- Calendar: Not connected\n\nUnusual detail:\n- Keep this detail.',
      ),
    ).toMatchObject([
      {
        title: 'Business profile',
        kind: 'business',
        blocks: [{ kind: 'field', label: 'Name', value: 'Example' }],
      },
      {
        title: 'Connections',
        kind: 'connections',
        blocks: [{ kind: 'field', label: 'Calendar', value: 'Not connected' }],
      },
      {
        title: 'Unusual detail',
        kind: 'answer',
        blocks: [{ kind: 'list', items: ['Keep this detail.'] }],
      },
    ]);
  });

  it('preserves the supplied brief rates, limits, connection qualifications and gaps', () => {
    const text = `Your business (from profile):
- Name: GreenVac - Base location: Braidwood - Services: Hydro excavation - Brand summary: Owner-operated.

Workspace/connectivity status:
- No saved records in this workspace yet.
- Google Calendar: connected and can create bookings (calendar.create available).
- Facebook Page: connected and ready for post preparation (facebookPreparationAvailable = true).
- Google Ads: not connected / reporting not available.

Key GreenVac operating rules I use when preparing quotes, bookings and job records (highlights):
- Minimum charge: AUD 650 inc GST.
- Hourly on-site rate: AUD 185 inc GST.
- After-hours rate: 1.5× hourly (after 18:00 weekdays and all weekend hours).
- Travel bands (from Braidwood): 0–20 km included; other bands require confirmation.
- Quote limit: any estimated total above AUD 4,500 requires explicit owner Accept.
- Variations: No change without approval.
- Booking rule: Confirm availability first.
- Pre-start requirements: Confirm access and service location.

What I don’t yet know / gaps you might want to fill:
- John's job date is unknown.

What would you like me to prepare next? (pick one or tell me):
- Prepare a quote for review.
- Prepare a booking for review.`;
    const sections = parseChatSections(text);
    expect(sections.map((section) => section.kind)).toEqual([
      'business',
      'connections',
      'rules',
      'gaps',
      'next',
    ]);
    expect(sections[0].blocks).toEqual([
      { kind: 'field', label: 'Name', value: 'GreenVac' },
      { kind: 'field', label: 'Base location', value: 'Braidwood' },
      { kind: 'field', label: 'Services', value: 'Hydro excavation' },
      { kind: 'field', label: 'Brand summary', value: 'Owner-operated.' },
    ]);
    expect(sections[1].blocks).toEqual([
      { kind: 'list', items: ['No saved records in this workspace yet.'] },
      {
        kind: 'field',
        label: 'Google Calendar',
        value: 'connected and can create bookings (calendar.create available).',
      },
      {
        kind: 'field',
        label: 'Facebook Page',
        value:
          'connected and ready for post preparation (facebookPreparationAvailable = true).',
      },
      {
        kind: 'field',
        label: 'Google Ads',
        value: 'not connected / reporting not available.',
      },
    ]);
    expect(sections[2].blocks).toEqual([
      { kind: 'field', label: 'Minimum charge', value: 'AUD 650 inc GST.' },
      {
        kind: 'field',
        label: 'Hourly on-site rate',
        value: 'AUD 185 inc GST.',
      },
      {
        kind: 'field',
        label: 'After-hours rate',
        value: '1.5× hourly (after 18:00 weekdays and all weekend hours).',
      },
      {
        kind: 'field',
        label: 'Travel bands (from Braidwood)',
        value: '0–20 km included; other bands require confirmation.',
      },
      {
        kind: 'field',
        label: 'Quote limit',
        value:
          'any estimated total above AUD 4,500 requires explicit owner Accept.',
      },
      {
        kind: 'field',
        label: 'Variations',
        value: 'No change without approval.',
      },
      {
        kind: 'field',
        label: 'Booking rule',
        value: 'Confirm availability first.',
      },
      {
        kind: 'field',
        label: 'Pre-start requirements',
        value: 'Confirm access and service location.',
      },
    ]);
    expect(sections[3].blocks).toEqual([
      { kind: 'list', items: ["John's job date is unknown."] },
    ]);
    expect(sections[4].blocks).toEqual([
      {
        kind: 'list',
        items: ['Prepare a quote for review.', 'Prepare a booking for review.'],
      },
    ]);
  });

  it('does not turn ordinary colons, dates, URLs or ambiguous dashes into structure', () => {
    for (const text of [
      'Remember:\nThis still needs your approval.',
      'https://example.test/a-b?q=-50',
      '18:00 weekdays; use the after-hours rate.',
      'This is owner-operated - Name: is a label in the form.',
      '1. Confirm access.\n2. Confirm the price before booking.',
    ]) {
      expect(parseChatSections(text)[0].blocks).toEqual([
        { kind: 'text', text },
      ]);
    }
  });

  it('keeps negative amounts and hyphenated words when splitting known compact fields', () => {
    expect(
      parseChatSections(
        '- Minimum charge: AUD -650 adjustment - Hourly on-site rate: AUD -185 pending review',
      )[0].blocks,
    ).toEqual([
      { kind: 'field', label: 'Minimum charge', value: 'AUD -650 adjustment' },
      {
        kind: 'field',
        label: 'Hourly on-site rate',
        value: 'AUD -185 pending review',
      },
    ]);
  });

  it('never treats delimiters inside Markdown links, code, parentheses or quoted text as fields', () => {
    const value =
      '[Check - Name: reference](https://example.test/a-b?q=-50) and ` - Services: literal` ( - Base location: example) " - Name: quoted"';
    expect(
      parseChatSections(`- Name: ${value} - Base location: Braidwood`)[0]
        .blocks,
    ).toEqual([
      { kind: 'field', label: 'Name', value },
      { kind: 'field', label: 'Base location', value: 'Braidwood' },
    ]);
  });

  it('keeps unfamiliar inline labels and unclosed markup without guessing boundaries', () => {
    for (const value of [
      'Example - Reminder: check the actual source.',
      'Example [ - Base location: Braidwood',
      'Example " - Base location: Braidwood',
    ]) {
      expect(parseChatSections(`- Name: ${value}`)[0].blocks).toEqual([
        { kind: 'field', label: 'Name', value },
      ]);
    }
  });

  it('preserves nested lists and continuation lines with their parent condition', () => {
    const text =
      '- Only after approval:\n  - Check access.\n  - Check the amount.\n  Keep the written record.\n- Do not book yet.';
    expect(parseChatSections(text)[0].blocks).toEqual([
      {
        kind: 'list',
        items: [
          'Only after approval:\n  - Check access.\n  - Check the amount.\n  Keep the written record.',
          'Do not book yet.',
        ],
      },
    ]);
  });

  it('preserves field continuation text and both bold-label forms', () => {
    expect(
      parseChatSections(
        '- **Rate:** AUD 185\n  Subject to confirmation.\n- **Limit**: Owner approval required.',
      )[0].blocks,
    ).toEqual([
      {
        kind: 'field',
        label: 'Rate',
        value: 'AUD 185\n  Subject to confirmation.',
      },
      { kind: 'field', label: 'Limit', value: 'Owner approval required.' },
    ]);
  });

  it('keeps fenced examples and tables unchanged without interpreting their contents', () => {
    const code =
      '```text\n## Business\n- Name: An example - Base location: An example\n```';
    const table =
      '| Charge | Condition |\n| --- | --- |\n| -50 | Approval required |';
    expect(parseChatSections(`${code}\n\n${table}`)).toMatchObject([
      {
        title: 'Answer',
        kind: 'answer',
        blocks: [
          { kind: 'text', text: code },
          { kind: 'text', text: table },
        ],
      },
    ]);
  });

  it('retains repeated and empty explicit headings with stable, distinct IDs', () => {
    const text =
      '## Rates\n- Awaiting confirmation.\n## Rates\n## Next steps\n- Ask the owner.';
    const first = parseChatSections(text);
    expect(first).toEqual(parseChatSections(text));
    expect(first.map((section) => section.id)).toEqual([
      'section-1',
      'section-2',
      'section-3',
    ]);
    expect(first[1]).toMatchObject({
      title: 'Rates',
      kind: 'rates',
      blocks: [],
    });
  });
});
