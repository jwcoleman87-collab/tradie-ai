import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentName } from '../contracts';
import { checked } from './db';

export type RecordContext = {
  records: unknown[];
  coverage: {
    returnedCount: number;
    totalMatchingCount: number | null;
    truncatedBodyCount: number;
    selection: 'newest_active_matching_kinds' | 'newest_and_conversation_focus';
    periodCoverage: 'not_established';
  };
};

const WEEKDAYS =
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)$/i;
const STOP = new Set([
  'called',
  'instead',
  'deep',
  'wants',
  'that',
  'this',
  'with',
  'from',
  'have',
  'been',
  'will',
  'just',
  'make',
  'what',
  'when',
  'your',
  'job',
]);

export function conversationFocusTerms(text: string | undefined) {
  if (!text) return [];
  const names = text.match(/\b[A-Z][a-z]{2,30}\b/g) || [];
  const refs = text.match(/\b[A-Z]{1,6}-?\d{2,8}\b/g) || [];
  return [...new Set([...names, ...refs])]
    .map((term) => term.replace(/[%_,()]/g, '').trim())
    .filter(
      (term) =>
        term.length >= 3 &&
        term.length <= 32 &&
        !WEEKDAYS.test(term) &&
        !STOP.has(term.toLowerCase()),
    )
    .slice(0, 3);
}

function kindsFor(agents: AgentName[]) {
  const kinds = {
    finance: ['invoice', 'expense', 'customer', 'job', 'note'],
    marketing: ['campaign', 'customer', 'job', 'note'],
    social: ['social', 'campaign', 'job', 'customer', 'note'],
    maintenance: ['asset', 'maintenance', 'note'],
    website: ['website', 'job', 'asset', 'note'],
  };
  return [...new Set(agents.flatMap((agent) => kinds[agent]))];
}

function clip(record: { body: string }) {
  return {
    ...record,
    body: record.body.slice(0, 2000),
    bodyShortened: record.body.length > 2000,
  };
}

function recordKey(record: { kind?: string; title?: string; body?: string }) {
  return `${record.kind}|${record.title}|${String(record.body || '').slice(0, 80)}`;
}

export async function loadRecordContext(
  db: SupabaseClient,
  workspaceId: string,
  agents: AgentName[],
  signal?: AbortSignal,
  conversationText?: string,
): Promise<RecordContext> {
  const kinds = kindsFor(agents);
  let query = db
    .from('business_records')
    .select('kind,title,body,source', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('kind', kinds)
    .order('created_at', { ascending: false })
    .limit(15);
  if (signal) query = query.abortSignal(signal);
  const result = await query;
  const newest = checked(result) || [];
  const terms = conversationFocusTerms(conversationText);
  let focused: typeof newest = [];
  if (terms.length) {
    const clause = terms
      .flatMap((term) => [
        `title.ilike.%${term}%`,
        `body.ilike.%${term}%`,
      ])
      .join(',');
    let focusQuery = db
      .from('business_records')
      .select('kind,title,body,source')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .in('kind', kinds)
      .or(clause)
      .order('created_at', { ascending: false })
      .limit(8);
    if (signal) focusQuery = focusQuery.abortSignal(signal);
    focused = checked(await focusQuery) || [];
  }
  const merged = [...newest];
  const seen = new Set(newest.map(recordKey));
  for (const record of focused) {
    const key = recordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(record);
  }
  return {
    records: merged.map(clip),
    coverage: {
      returnedCount: merged.length,
      totalMatchingCount: result.count ?? null,
      truncatedBodyCount: merged.filter((record) => record.body.length > 2000)
        .length,
      selection: focused.length
        ? 'newest_and_conversation_focus'
        : 'newest_active_matching_kinds',
      periodCoverage: 'not_established',
    },
  };
}

export function financeDisclosure(context: RecordContext): string {
  const c = context.coverage;
  const count =
    c.totalMatchingCount === null
      ? `${c.returnedCount} relevant saved records; the full record count is unavailable`
      : `${c.returnedCount} of ${c.totalMatchingCount} relevant saved records`;
  const shortened = c.truncatedBodyCount
    ? ` ${c.truncatedBodyCount} record${c.truncatedBodyCount === 1 ? ' was' : 's were'} shortened.`
    : '';
  return `Data coverage: based on ${count}.${shortened} This saved-record view is not a complete period total; coverage of the requested period has not been verified. Calculations may also use evidence you supplied in this conversation.`;
}
