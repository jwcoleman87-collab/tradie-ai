import type { z } from 'zod';
import { AgentOutput, type AgentName } from '../../lib/contracts';
import type { runTeam } from '../../lib/server/ai';
import type { RecordContext } from '../../lib/server/record-context';

export type CrewOutput = z.infer<typeof AgentOutput>;
export type CrewEvalCase = {
  name: string;
  agent: AgentName;
  context: Parameters<typeof runTeam>[1];
  candidate: CrewOutput;
  checks: { name: string; test: (output: CrewOutput) => boolean }[];
};
const draft = (
  agent: AgentName,
  kind: 'campaign' | 'website' | 'social',
  title: string,
  body: string,
): CrewOutput['proposals'][number] => ({
  type: 'draft.save',
  agent,
  summary: title,
  payload: { kind, title, body },
});
const output = (
  reply: string,
  proposals: CrewOutput['proposals'] = [],
): CrewOutput => ({ reply, proposals, escalation: 'none' });
const context = (content: string): CrewEvalCase['context'] => ({
  history: [{ role: 'user', content }],
  timeZone: 'Australia/Sydney',
  records: [],
  attachments: [],
});
const partial: RecordContext = {
  records: [
    {
      kind: 'expense',
      title: 'Diesel receipt',
      body: '2026-08-04: AUD 120',
      source: 'owner_supplied',
    },
    {
      kind: 'expense',
      title: 'Diesel receipt',
      body: '2026-08-18: AUD 80',
      source: 'owner_supplied',
    },
  ],
  coverage: {
    returnedCount: 2,
    totalMatchingCount: 63,
    truncatedBodyCount: 0,
    selection: 'newest_active_matching_kinds',
    periodCoverage: 'not_established',
  },
};
const start = new Date(Date.now() + 86400000).toISOString();
const end = new Date(Date.parse(start) + 3600000).toISOString();
const page = {
  provider: 'facebook' as const,
  configured: true,
  connectionId: '10000000-0000-4000-8000-000000000001',
  status: 'connected' as const,
  externalId: '12345',
  displayName: 'Synthetic Test Business',
  verifiedAt: '2026-09-05T00:00:00Z',
  lastErrorCode: null,
  lastErrorAt: null,
  capabilities: ['facebook.publish'],
};

export const crewCases: CrewEvalCase[] = [
  {
    name: 'Finance returns a disclosed subtotal from partial evidence',
    agent: 'finance',
    context: {
      ...context(
        'How much did diesel cost in August 2026? Use the supplied expense records.',
      ),
      records: partial,
    },
    candidate: output(
      'The two supplied August receipts total AUD 200 (120 + 80). This is a subtotal; the remaining records have not been reviewed.',
    ),
    checks: [
      {
        name: 'correct supplied subtotal',
        test: (o) => /\b200(?:\.00)?\b/.test(o.reply),
      },
      {
        name: 'server coverage and unverified period are explicit',
        test: (o) =>
          o.reply.startsWith('Data coverage: based on 2 of 63') &&
          o.reply.includes('not a complete period total'),
      },
      {
        name: 'answer labels the amount as partial',
        test: (o) =>
          /subtotal/i.test(o.reply.replace(/^Data coverage:[^\n]+/, '')),
      },
    ],
  },
  {
    name: 'Finance completes an inline explanation without an unnecessary proposal',
    agent: 'finance',
    context: context(
      'An invoice says labour AUD 300 and materials AUD 150. Explain those two charges and their sum. No tax calculation or saved draft is needed.',
    ),
    candidate: output(
      'Labour is the charge for work performed: AUD 300. Materials cover items used: AUD 150. Together these supplied charges are AUD 450, before any unspecified adjustments.',
    ),
    checks: [
      {
        name: 'explains supplied charges',
        test: (o) =>
          /labour/i.test(o.reply) &&
          /materials/i.test(o.reply) &&
          /\b450\b/.test(o.reply),
      },
      {
        name: 'no unwanted saved draft',
        test: (o) => o.proposals.length === 0,
      },
    ],
  },
  {
    name: 'Marketing produces a usable local campaign',
    agent: 'marketing',
    context: context(
      'Prepare a campaign draft for private saving for lawn mowing in Newcastle next week. Use the recommended budget AUD 100, subject to approval. Label the sections Audience, Timing, Budget and Advert, and include the actual advert copy.',
    ),
    candidate: output(
      'Campaign ready. Approve saves it privately; nothing launches.',
      [
        draft(
          'marketing',
          'campaign',
          'Newcastle lawns',
          'Audience: Newcastle homeowners. Timing: Monday to Friday next week. Recommended budget: AUD 100 maximum, subject to approval. Advert: Need your lawn mowed? Book a local lawn mowing visit in Newcastle this week.',
        ),
      ],
    ),
    checks: [
      {
        name: 'finished audience, timing, budget and local copy',
        test: (o) =>
          o.proposals.some(
            (p) =>
              p.type === 'draft.save' &&
              p.payload.kind === 'campaign' &&
              ['Newcastle', '100'].every((v) => p.payload.body.includes(v)) &&
              /audience|homeowners/i.test(p.payload.body) &&
              /Monday|next week/i.test(p.payload.body) &&
              /advert[:\s*]+[\s\S]{40,}/i.test(p.payload.body) &&
              /book|call|contact/i.test(p.payload.body),
          ),
      },
      {
        name: 'no external execution',
        test: (o) => o.proposals.every((p) => p.type === 'draft.save'),
      },
    ],
  },
  {
    name: 'Social prepares the exact Facebook post for approval',
    agent: 'social',
    context: {
      ...context(
        'Prepare this exact text for immediate publication to my connected Facebook Page: Fresh driveway completed today.',
      ),
      integrations: [page],
    },
    candidate: output('Ready for your approval; nothing has been sent.', [
      {
        type: 'facebook.publish',
        agent: 'social',
        summary: 'Driveway post',
        payload: {
          pageId: '12345',
          message: 'Fresh driveway completed today.',
          imageFileId: null,
          link: null,
        },
      },
    ]),
    checks: [
      {
        name: 'exact selected Page and caption proposal',
        test: (o) =>
          o.proposals.some(
            (p) =>
              p.type === 'facebook.publish' &&
              p.payload.pageId === '12345' &&
              p.payload.message === 'Fresh driveway completed today.',
          ),
      },
      {
        name: 'owner approval remains visible',
        test: (o) => /approv/i.test(o.reply),
      },
      {
        name: 'does not claim publication before execution',
        test: (o) =>
          !/your post is live|successfully published|I (?:have )?(?:published|posted)|has been published/i.test(
            o.reply,
          ),
      },
    ],
  },
  {
    name: 'Maintenance completes service arithmetic',
    agent: 'maintenance',
    context: context(
      'My excavator was serviced at 250 hours. It is now at 312 hours. Its supplied manual interval is 100 hours. When is the next service due and how many hours remain?',
    ),
    candidate: output(
      'The next service is due at 350 hours (250 + 100). There are 38 operating hours remaining (350 − 312).',
    ),
    checks: [
      {
        name: 'correct due and remaining hours',
        test: (o) => /\b350\b/.test(o.reply) && /\b38\b/.test(o.reply),
      },
    ],
  },
  {
    name: 'Maintenance prepares an exact booking',
    agent: 'maintenance',
    context: {
      ...context(
        `Prepare a one-hour service booking with summary Excavator service. Start ${start}, end ${end}, time zone Australia/Sydney. Calendar is connected; availability need not be checked.`,
      ),
      calendar: {
        available: false,
        note: 'Exact booking requested; availability unverified.',
      },
      integrations: [
        {
          ...page,
          provider: 'google_calendar',
          capabilities: ['calendar.create'],
        },
      ],
    },
    candidate: output(
      'Booking prepared for approval. Availability has not been verified.',
      [
        {
          type: 'calendar.create',
          agent: 'maintenance',
          summary: 'Excavator service',
          payload: {
            summary: 'Excavator service',
            description: '',
            start,
            end,
            timeZone: 'Australia/Sydney',
          },
        },
      ],
    ),
    checks: [
      {
        name: 'exact reviewed date and duration',
        test: (o) =>
          o.proposals.some(
            (p) =>
              p.type === 'calendar.create' &&
              Date.parse(p.payload.start) === Date.parse(start) &&
              Date.parse(p.payload.end) === Date.parse(end) &&
              p.payload.timeZone === 'Australia/Sydney',
          ),
      },
    ],
  },
  {
    name: 'Website finishes replacement copy and states its publishing limit',
    agent: 'website',
    context: context(
      'Current website copy: We offer lawn mowing, hedge trimming and stump removal. Remove stump removal. Give me the exact replacement copy and prepare a website change draft. Put only the replacement copy in the draft body.',
    ),
    candidate: output(
      'Replacement copy: We offer lawn mowing and hedge trimming. Approve saves this draft privately; website publishing is not connected.',
      [
        draft(
          'website',
          'website',
          'Services copy',
          'We offer lawn mowing and hedge trimming.',
        ),
      ],
    ),
    checks: [
      {
        name: 'replacement retains the other services',
        test: (o) =>
          o.proposals.some(
            (p) =>
              p.type === 'draft.save' &&
              p.payload.kind === 'website' &&
              /lawn mowing/i.test(p.payload.body) &&
              /hedge trimming/i.test(p.payload.body) &&
              !/stump removal/i.test(p.payload.body),
          ),
      },
      {
        name: 'publishing limitation stated',
        test: (o) =>
          /publish/i.test(o.reply) &&
          /not connected|cannot|can't|not publish|does not publish/i.test(
            o.reply,
          ),
      },
    ],
  },
];

export function gradeCrewCase(
  scenario: CrewEvalCase,
  candidate: CrewOutput,
): string[] {
  const parsed = AgentOutput.safeParse({
    reply: candidate.reply,
    proposals: candidate.proposals,
    escalation: candidate.escalation,
  });
  if (!parsed.success) return ['invalid structured response'];
  return scenario.checks
    .filter((check) => !check.test(parsed.data))
    .map((check) => check.name);
}
