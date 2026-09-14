/** These are editable Chat requests, never approval or execution commands. */
export const chatReplyActions = [
  {
    group: 'Business',
    actions: [
      {
        id: 'profile',
        label: 'Review profile',
        prompt:
          'Review my saved business profile. Show what is known and ask for any missing details without changing saved facts.',
      },
      {
        id: 'job',
        label: 'Prepare job record',
        prompt:
          'Help me prepare a job record. Ask for the actual customer, site and job details you still need. Do not invent missing facts.',
      },
    ],
  },
  {
    group: 'Quotes & bookings',
    actions: [
      {
        id: 'quote',
        label: 'Draft quote',
        prompt:
          'Help me draft a quote for review. Use only verified business rates and ask for missing customer, site, scope, access and spoil details.',
      },
      {
        id: 'variation',
        label: 'Draft variation',
        prompt:
          'Help me draft a variation for review. Ask which existing job or quote and what has changed. Do not overwrite the original quote.',
      },
      {
        id: 'booking',
        label: 'Prepare booking',
        prompt:
          'Help me prepare a booking for review. Ask for any missing site, customer, exact start and end times and time zone. Do not book until I approve the action.',
      },
    ],
  },
  {
    group: 'Marketing',
    actions: [
      {
        id: 'facebook',
        label: 'Prepare Facebook post',
        prompt:
          'Help me prepare a Facebook post for review. Ask for the topic and any photo details or permission you still need. Do not publish until I approve the action.',
      },
      {
        id: 'website',
        label: 'Draft website copy',
        prompt:
          'Help me draft website copy for review. Ask which page, its purpose and any missing business facts. Do not publish anything.',
      },
      {
        id: 'campaign',
        label: 'Draft campaign',
        prompt:
          'Help me draft a campaign for review. Ask for the goal, audience and channel. Do not launch ads or spend money.',
      },
    ],
  },
] as const;

export type ChatReplyActionId =
  (typeof chatReplyActions)[number]['actions'][number]['id'];

export function appendChatRequest(current: string, prompt: string) {
  if (!current.trim()) return prompt;
  if (current.trimEnd().endsWith(prompt)) return current;
  const next = `${current.trimEnd()}\n\n${prompt}`;
  return next.length <= 12000 ? next : current;
}
