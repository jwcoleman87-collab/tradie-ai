import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentName } from '../contracts';
import { checked } from './db';

type LoadedRecord = {
  id?: string;
  kind: string;
  title: string;
  body: string;
  source: string;
};

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
const CLOSED = new Set([
  'the',
  'and',
  'for',
  'not',
  'but',
  'you',
  'our',
  'are',
  'was',
  'can',
  'get',
  'got',
  'now',
  'new',
  'please',
  'also',
  'this',
  'that',
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
  'one',
  'about',
  'quote',
  'customer',
  'trench',
  'move',
  'site',
  'around',
  'called',
  'instead',
  'deep',
  'wants',
]);
const FOCUS_USER_TURNS = 6;
const FOCUS_TURN_CHARS = 400;
const FOCUS_TERM_LIMIT = 6;
const FOCUS_PER_TURN = 3;
const RECORD_FIELDS = 'id,kind,title,body,source';

export function recentUserFocusText(
  history: { role: string; content: string }[] | undefined,
) {
  if (!history?.length) return '';
  return history
    .filter((message) => message.role === 'user')
    .slice(-FOCUS_USER_TURNS)
    .map((message) => message.content.slice(0, FOCUS_TURN_CHARS))
    .join('\n');
}

function cleanTerm(value: string) {
  return value.replace(/[%_,()]/g, '').trim().toLowerCase();
}

function addIdentifier(found: string[], seen: Set<string>, raw: string) {
  const term = cleanTerm(raw);
  if (term.length < 3 || term.length > 32) return;
  if (WEEKDAYS.test(term) || CLOSED.has(term) || seen.has(term)) return;
  seen.add(term);
  found.push(term);
}

export function extractIdentifiers(text: string) {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\b[a-z]{1,6}-?\d{2,8}\b/gi))
    addIdentifier(found, seen, match[0]);
  for (const match of text.matchAll(/\b([A-Za-z]{3,30})['’]s\b/g))
    addIdentifier(found, seen, match[1]);
  for (const match of text.matchAll(/\b([A-Za-z]{3,30})\s+called\b/gi))
    addIdentifier(found, seen, match[1]);
  for (const match of text.matchAll(/\bmove\s+([A-Za-z]{3,30})\b/gi))
    addIdentifier(found, seen, match[1]);
  for (const match of text.matchAll(
    /\b(?:for|customer|client)\s+([A-Za-z]{3,30})\b/gi,
  ))
    addIdentifier(found, seen, match[1]);
  for (const match of text.matchAll(/["“]([^"”]{2,40})["”]/g))
    addIdentifier(found, seen, match[1]);
  for (const match of text.matchAll(/\b[A-Z][a-z]{2,30}\b/g))
    addIdentifier(found, seen, match[0]);
  return found;
}

export function conversationFocusTerms(text: string | undefined) {
  if (!text) return [];
  const turns = text.split('\n');
  const terms: string[] = [];
  const seen = new Set<string>();
  for (let i = turns.length - 1; i >= 0; i--) {
    let added = 0;
    for (const term of extractIdentifiers(turns[i])) {
      if (seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
      added += 1;
      if (added >= FOCUS_PER_TURN || terms.length >= FOCUS_TERM_LIMIT) break;
    }
    if (terms.length >= FOCUS_TERM_LIMIT) break;
  }
  return terms;
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

function clip(record: LoadedRecord) {
  return {
    kind: record.kind,
    title: record.title,
    body: record.body.slice(0, 2000),
    source: record.source,
    bodyShortened: record.body.length > 2000,
  };
}

function persistentId(record: LoadedRecord) {
  return typeof record.id === 'string' && record.id ? record.id : null;
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
    .select(RECORD_FIELDS, { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('kind', kinds)
    .order('created_at', { ascending: false })
    .limit(15);
  if (signal) query = query.abortSignal(signal);
  const result = await query;
  const newest = (checked(result) || []) as LoadedRecord[];
  const terms = conversationFocusTerms(conversationText);
  let focused: LoadedRecord[] = [];
  if (terms.length) {
    const clause = terms
      .flatMap((term) => [`title.ilike.%${term}%`, `body.ilike.%${term}%`])
      .join(',');
    let focusQuery = db
      .from('business_records')
      .select(RECORD_FIELDS)
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .in('kind', kinds)
      .or(clause)
      .order('created_at', { ascending: false })
      .limit(8);
    if (signal) focusQuery = focusQuery.abortSignal(signal);
    focused = (checked(await focusQuery) || []) as LoadedRecord[];
  }
  const merged: LoadedRecord[] = [];
  const seen = new Set<string>();
  for (const record of [...newest, ...focused]) {
    const id = persistentId(record);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
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
