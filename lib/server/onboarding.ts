import { z } from 'zod';
import {
  OnboardingFactValue,
  OnboardingFieldPath,
  type OnboardingFact,
  type OnboardingField,
} from '../contracts';

export const onboardingGoals = [
  'identity_anchor',
  'preferred_work',
  'enquiry_admin',
  'first_bottleneck',
] as const;
export const OnboardingGoal = z.enum(onboardingGoals);
export type OnboardingGoalName = z.infer<typeof OnboardingGoal>;

const FactDraft = z
  .object({
    fieldPath: OnboardingFieldPath,
    value: OnboardingFactValue,
    confidence: z.enum(['high', 'medium', 'low']),
    factState: z.enum(['owner_supplied', 'inferred', 'needs_confirmation']),
  })
  .strict();
export type FactDraft = z.infer<typeof FactDraft>;

export const OnboardingTurn = z
  .object({
    reply: z.string().trim().min(1).max(1200),
    facts: z.array(FactDraft).max(12),
    goalsCovered: z.array(OnboardingGoal).max(4),
    nextGoal: OnboardingGoal.nullable(),
    reviewReady: z.boolean(),
  })
  .strict();
export type OnboardingTurnResult = z.infer<typeof OnboardingTurn>;

export const firstOnboardingPrompt =
  'What is the business called, where are you based, and what sort of work keeps you busiest? If you know your website or business profile, include it — but you do not have to go looking for it.';

export const onboardingFieldLabels: Record<OnboardingField, string> = {
  display_name: 'Business name',
  website_url: 'Website',
  base_location: 'Based in',
  service_areas: 'Service areas',
  services: 'Work you do',
  preferred_job_types: 'Work you want more of',
  enquiry_channels: 'Where enquiries arrive',
  primary_goal: 'First outcome',
  admin_bottleneck: 'Biggest admin bottleneck',
  brand_summary: 'Business summary',
};

const questions: Record<OnboardingGoalName, string> = {
  identity_anchor:
    'I’m missing one useful search anchor. What is the business name, your base or service area, and the main work you do? Just add whichever part I missed.',
  preferred_work:
    'Of the work you do, which jobs would you most like more of — and which customers are the best fit?',
  enquiry_admin:
    'Where do new enquiries and day-to-day admin reach you now — phone, email, social, a job system, or somewhere else?',
  first_bottleneck:
    'What is the one business or admin bottleneck you want your crew to take off your plate first?',
};

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const unique = (values: string[]) => [
  ...new Set(values.map(clean).filter(Boolean)),
];
const arrayValue = (value: string) =>
  unique(
    value
      .split(/,|\band\b|\bor\b/gi)
      .map((part) => part.replace(/^[\s:;-]+|[\s.;-]+$/g, '')),
  ).slice(0, 12);
const matchValue = (answer: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = answer.match(pattern)?.[1];
    if (match) return clean(match.replace(/[.]+$/, ''));
  }
  return '';
};

export function extractIdentityFacts(answer: string): FactDraft[] {
  const facts: FactDraft[] = [];
  const url = answer.match(/https?:\/\/[^\s,]+|\b(?:www\.)[^\s,]+/i)?.[0];
  const displayName = matchValue(answer, [
    /(?:business (?:is|called)|company (?:is|called)|we(?:'re| are) called|i (?:run|own))\s+["']?([^,.;\n]+?)(?=\s+(?:and|based|in|from|doing|we)|[,.;]|$)/i,
    /(?:it(?:'s| is)|the name is)\s+["']?([^,.;\n]+?)(?=\s+(?:and|based|in|from|doing|we)|[,.;]|$)/i,
    /(?:^|\n)\s*([^,;\n]{2,80})\s*,\s*[^,;\n]{2,100}\s*,/i,
  ]);
  const baseLocation = matchValue(answer, [
    /(?:based|located|operate|working)\s+(?:in|around|from)\s+([^,.;\n]+?)(?=\s+(?:and|doing|we)|[,.;]|$)/i,
    /(?:^|\n)\s*[^,;\n]{2,80}\s*,\s*([^,;\n]{2,100})\s*,/i,
  ]);
  const services = matchValue(answer, [
    /(?:speciali[sz]e in|mostly do|we do|work keeps (?:us|me) busiest|busiest (?:work|jobs)(?: are| is)?|work is)\s+([^.;\n]+)/i,
    /(?:^|\n)\s*[^,;\n]{2,80}\s*,\s*[^,;\n]{2,100}\s*,\s*([^;\n]+)/i,
  ]);
  if (displayName)
    facts.push({
      fieldPath: 'display_name',
      value: displayName,
      confidence: 'medium',
      factState: 'owner_supplied',
    });
  if (baseLocation)
    facts.push({
      fieldPath: 'base_location',
      value: baseLocation,
      confidence: 'medium',
      factState: 'owner_supplied',
    });
  if (services) {
    const values = arrayValue(services);
    if (values.length)
      facts.push({
        fieldPath: 'services',
        value: values,
        confidence: 'medium',
        factState: 'owner_supplied',
      });
  }
  if (url) {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (z.url({ protocol: /^https?$/ }).safeParse(normalized).success)
      facts.push({
        fieldPath: 'website_url',
        value: normalized.replace(/[).,;]+$/, ''),
        confidence: 'high',
        factState: 'owner_supplied',
      });
  }
  facts.push({
    fieldPath: 'brand_summary',
    value: clean(answer).slice(0, 1000),
    confidence: 'high',
    factState: 'owner_supplied',
  });
  return facts;
}

function goalFacts(goal: OnboardingGoalName, answer: string): FactDraft[] {
  if (goal === 'identity_anchor') return extractIdentityFacts(answer);
  if (goal === 'preferred_work')
    return [
      {
        fieldPath: 'preferred_job_types',
        value: arrayValue(answer).length ? arrayValue(answer) : [clean(answer)],
        confidence: 'high',
        factState: 'owner_supplied',
      },
      {
        fieldPath: 'primary_goal',
        value: `Win more of: ${clean(answer)}`.slice(0, 1000),
        confidence: 'medium',
        factState: 'inferred',
      },
    ];
  if (goal === 'enquiry_admin')
    return [
      {
        fieldPath: 'enquiry_channels',
        value: arrayValue(answer).length ? arrayValue(answer) : [clean(answer)],
        confidence: 'high',
        factState: 'owner_supplied',
      },
    ];
  return [
    {
      fieldPath: 'admin_bottleneck',
      value: clean(answer),
      confidence: 'high',
      factState: 'owner_supplied',
    },
    {
      fieldPath: 'primary_goal',
      value: clean(answer),
      confidence: 'medium',
      factState: 'inferred',
    },
  ];
}

const goalFields: Record<OnboardingGoalName, OnboardingField[]> = {
  identity_anchor: [
    'display_name',
    'base_location',
    'services',
    'brand_summary',
  ],
  preferred_work: ['preferred_job_types'],
  enquiry_admin: ['enquiry_channels'],
  first_bottleneck: ['admin_bottleneck'],
};

export function buildOnboardingTurn(input: {
  answer: string;
  currentGoal: OnboardingGoalName;
  goalsCovered: OnboardingGoalName[];
  existingFacts: Pick<OnboardingFact, 'field_path' | 'value'>[];
}): OnboardingTurnResult {
  const facts = goalFacts(input.currentGoal, input.answer);
  if (input.currentGoal === 'identity_anchor') {
    const existing = new Set(
      input.existingFacts.map((fact) => fact.field_path),
    );
    const singleMissing = (
      ['display_name', 'base_location', 'services'] as const
    ).filter((field) => !existing.has(field));
    if (
      singleMissing.length === 1 &&
      !facts.some((fact) => fact.fieldPath === singleMissing[0])
    )
      facts.push({
        fieldPath: singleMissing[0],
        value:
          singleMissing[0] === 'services'
            ? arrayValue(input.answer)
            : clean(input.answer),
        confidence: 'high',
        factState: 'owner_supplied',
      });
  }
  const known = new Set([
    ...input.existingFacts.map((fact) => fact.field_path),
    ...facts.map((fact) => fact.fieldPath),
  ]);
  const covered = new Set(input.goalsCovered);
  if (input.currentGoal !== 'identity_anchor') covered.add(input.currentGoal);
  for (const goal of onboardingGoals) {
    const fields = goalFields[goal];
    const complete =
      goal === 'identity_anchor'
        ? fields
            .filter((field) => field !== 'brand_summary')
            .every((field) => known.has(field))
        : fields.some((field) => known.has(field));
    if (complete) covered.add(goal);
    else if (goal === 'identity_anchor') covered.delete(goal);
  }
  const nextGoal = onboardingGoals.find((goal) => !covered.has(goal)) || null;
  const reviewReady = nextGoal === null;
  return OnboardingTurn.parse({
    reply: reviewReady
      ? 'That gives me enough to prepare a useful first profile. Review what I found below — especially anything marked inferred — and correct it before you confirm.'
      : questions[nextGoal],
    facts,
    goalsCovered: [...covered],
    nextGoal,
    reviewReady,
  });
}

export function provisionalBusinessName(answer: string) {
  const fact = extractIdentityFacts(answer).find(
    (candidate) => candidate.fieldPath === 'display_name',
  );
  return typeof fact?.value === 'string'
    ? fact.value.slice(0, 120)
    : 'My business';
}

export function factValueForProfile(value: string | string[]) {
  return Array.isArray(value) ? unique(value) : clean(value);
}
