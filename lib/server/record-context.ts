import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentName } from '../contracts';
import { checked } from './db';

export type RecordContext = {
  records: unknown[];
  coverage: {
    returnedCount: number;
    totalMatchingCount: number | null;
    truncatedBodyCount: number;
    selection: 'newest_active_matching_kinds';
    periodCoverage: 'not_established';
  };
};

export async function loadRecordContext(
  db: SupabaseClient,
  workspaceId: string,
  agents: AgentName[],
  signal?: AbortSignal,
): Promise<RecordContext> {
  const kinds = {
    finance: ['invoice', 'expense', 'customer', 'job', 'note'],
    marketing: ['campaign', 'customer', 'job', 'note'],
    social: ['social', 'campaign', 'job', 'customer', 'note'],
    maintenance: ['asset', 'maintenance', 'note'],
    website: ['website', 'job', 'asset', 'note'],
  };
  let query = db
    .from('business_records')
    .select('kind,title,body,source', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('kind', [...new Set(agents.flatMap((agent) => kinds[agent]))])
    .order('created_at', { ascending: false })
    .limit(15);
  if (signal) query = query.abortSignal(signal);
  const result = await query;
  const rows = checked(result) || [];
  return {
    records: rows.map((record) => ({
      ...record,
      body: record.body.slice(0, 2000),
      bodyShortened: record.body.length > 2000,
    })),
    coverage: {
      returnedCount: rows.length,
      totalMatchingCount: result.count ?? null,
      truncatedBodyCount: rows.filter((record) => record.body.length > 2000)
        .length,
      selection: 'newest_active_matching_kinds',
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
