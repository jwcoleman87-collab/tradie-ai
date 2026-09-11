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
const FOCUS_TERM_LIMIT = 6;
const FOCUS_PER_TURN = 3;
const FOCUS_RESULT_LIMIT = 8;
const RECORD_FIELDS = 'id,kind,title,body,source';

export function recentUserFocusText(
  history: { role: string; content: string }[] | undefined,
) {
  if (!history?.length) return '';
  return history
    .filter((message) => message.role === 'user')
    .slice(-FOCUS_USER_TURNS)
    .map((message) => message.content)
    .join('\n');
}

function cleanTerm(value: string) {
  return value.replace(/[%_,()]/g, '').trim().toLowerCase();
}

function validTerm(raw: string) {
  const term = cleanTerm(raw);
  if (term.length < 3 || term.length > 32) return '';
  if (WEEKDAYS.test(term) || CLOSED.has(term)) return '';
  return term;
}

export function extractIdentifiers(text: string) {
  const hits: { term: string; index: number; weight: number }[] = [];
  function collect(
    pattern: RegExp,
    weight: number,
    pick: (match: RegExpMatchArray) => string,
  ) {
    for (const match of text.matchAll(pattern)) {
      const term = validTerm(pick(match));
      if (!term) continue;
      hits.push({ term, index: match.index ?? 0, weight });
    }
  }
  collect(/\b[a-z]{1,6}-?\d{2,8}\b/gi, 1, (match) => match[0]);
  collect(/\b([A-Za-z]{3,30})['’]s\b/g, 3, (match) => match[1]);
  collect(/\b([A-Za-z]{3,30})\s+called\b/gi, 3, (match) => match[1]);
  collect(/\bmove\s+([A-Za-z]{3,30})\b/gi, 3, (match) => match[1]);
  collect(
    /\b(?:for|customer|client)\s+([A-Za-z]{3,30})\b/gi,
    3,
    (match) => match[1],
  );
  collect(/["“]([^"”]{2,40})["”]/g, 3, (match) => match[1]);
  collect(/\b[A-Z][a-z]{2,30}\b/g, 2, (match) => match[0]);
  hits.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.term)) continue;
    seen.add(hit.term);
    found.push(hit.term);
  }
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

function remember(record: LoadedRecord, seen: Set<string>) {
  const id = persistentId(record);
  if (!id) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}

async function queryFocusTerm(
  db: SupabaseClient,
  workspaceId: string,
  kinds: string[],
  term: string,
  signal?: AbortSignal,
) {
  let focusQuery = db
    .from('business_records')
    .select(RECORD_FIELDS)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('kind', kinds)
    .or(`title.ilike.%${term}%,body.ilike.%${term}%`)
    .order('created_at', { ascending: false })
    .limit(FOCUS_RESULT_LIMIT);
  if (signal) focusQuery = focusQuery.abortSignal(signal);
  return (checked(await focusQuery) || []) as LoadedRecord[];
}

async function loadFocusedRecords(
  db: SupabaseClient,
  workspaceId: string,
  kinds: string[],
  terms: string[],
  already: Set<string>,
  signal?: AbortSignal,
) {
  const perTerm = await Promise.all(
    terms.map((term) => queryFocusTerm(db, workspaceId, kinds, term, signal)),
  );
  const focused: LoadedRecord[] = [];
  const seen = new Set<string>(already);
  const leftovers: LoadedRecord[][] = [];
  for (const rows of perTerm) {
    let reserved: LoadedRecord | undefined;
    const rest: LoadedRecord[] = [];
    for (const record of rows) {
      const id = persistentId(record);
      if (id && seen.has(id)) continue;
      if (!reserved) reserved = record;
      else rest.push(record);
    }
    leftovers.push(rest);
    if (!reserved || !remember(reserved, seen)) continue;
    focused.push(reserved);
    if (focused.length >= FOCUS_RESULT_LIMIT) return focused;
  }
  for (const rows of leftovers) {
    for (const record of rows) {
      if (!remember(record, seen)) continue;
      focused.push(record);
      if (focused.length >= FOCUS_RESULT_LIMIT) return focused;
    }
  }
  return focused;
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
  const already = new Set(
    newest.map(persistentId).filter((id): id is string => !!id),
  );
  const focused = terms.length
    ? await loadFocusedRecords(db, workspaceId, kinds, terms, already, signal)
    : [];
  const merged: LoadedRecord[] = [];
  const seen = new Set<string>();
  for (const record of [...newest, ...focused]) {
    if (!remember(record, seen)) continue;
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
