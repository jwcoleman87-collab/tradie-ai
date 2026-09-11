import { expect, it } from 'vitest';
import {
  conversationFocusTerms,
  financeDisclosure,
  loadRecordContext,
  recentUserFocusText,
} from '../lib/server/record-context';
import { memoryDb } from './fixtures/memory-db';

it('discloses 15 of 63 records and every shortened body without claiming period coverage', async () => {
  const rows = Array.from({ length: 63 }, (_, i) => ({
    id: `exp-${i}`,
    workspace_id: 'a',
    status: 'active',
    kind: 'expense',
    title: `Expense ${i}`,
    body: 'x'.repeat(2100),
    source: 'owner_supplied',
    created_at: String(i).padStart(3, '0'),
  }));
  const { db } = memoryDb({
    business_records: [
      ...rows,
      { ...rows[0], id: 'b-0', workspace_id: 'b' },
      { ...rows[0], id: 'arch-0', status: 'archived' },
    ],
  });
  const result = await loadRecordContext(db, 'a', ['finance']);
  expect(result.coverage).toMatchObject({
    returnedCount: 15,
    totalMatchingCount: 63,
    truncatedBodyCount: 15,
    periodCoverage: 'not_established',
  });
  expect(financeDisclosure(result)).toContain('15 of 63');
  expect(financeDisclosure(result)).toContain('15 records were shortened');
  expect(financeDisclosure(result)).toContain('not a complete period total');
  expect(JSON.stringify(result.records)).not.toContain('"id"');
});
it('allows Social to use saved jobs, and never equates all stored rows to complete books', async () => {
  const { db } = memoryDb({
    business_records: [
      {
        id: 'job-drive',
        workspace_id: 'a',
        status: 'active',
        kind: 'job',
        title: 'Driveway',
        body: 'Finished a driveway.',
        source: 'owner_supplied',
        created_at: '2026-09-01',
      },
    ],
  });
  const result = await loadRecordContext(db, 'a', ['social']);
  expect(result.records).toHaveLength(1);
  expect(financeDisclosure(result)).toContain('1 of 1');
  expect(financeDisclosure(result)).toContain('period has not been verified');
  result.coverage.totalMatchingCount = null;
  expect(financeDisclosure(result)).toContain(
    'full record count is unavailable',
  );
});

function johnRecords() {
  const recent = Array.from({ length: 15 }, (_, i) => ({
    id: `diesel-${i}`,
    workspace_id: 'a',
    status: 'active',
    kind: 'expense',
    title: `Diesel ${i}`,
    body: 'AUD 40',
    source: 'owner_supplied',
    created_at: `2026-09-${String(i + 1).padStart(2, '0')}`,
  }));
  return {
    business_records: [
      ...recent,
      {
        id: 'job-john',
        workspace_id: 'a',
        status: 'active',
        kind: 'job',
        title: 'Trench around existing power',
        body: 'John Hale, Kingston ACT. 6 hours. Quote GV-1042 AUD 1110.',
        source: 'owner_supplied',
        created_at: '2026-08-01',
      },
      {
        id: 'job-other-tenant',
        workspace_id: 'b',
        status: 'active',
        kind: 'job',
        title: 'John other tenant',
        body: 'Must not leak.',
        source: 'owner_supplied',
        created_at: '2026-08-01',
      },
    ],
  };
}

function hasKingstonJob(records: unknown[]) {
  return records.some(
    (record) =>
      typeof record === 'object' &&
      record !== null &&
      'title' in record &&
      String(record.title).includes('Trench'),
  );
}

it('pulls a matching John job even when it is older than the newest fifteen records', async () => {
  const { db } = memoryDb(johnRecords());
  const result = await loadRecordContext(
    db,
    'a',
    ['finance'],
    undefined,
    'John called. Friday instead, 600 deep.',
  );
  expect(result.coverage.selection).toBe('newest_and_conversation_focus');
  expect(hasKingstonJob(result.records)).toBe(true);
  expect(JSON.stringify(result.records)).not.toContain('other tenant');
});

it('retrieves the older John record from a follow-up turn that does not restate the name', async () => {
  const { db } = memoryDb(johnRecords());
  const focus = recentUserFocusText([
    {
      role: 'user',
      content: "John's GV-1042 trench is the one in Kingston.",
    },
    { role: 'assistant', content: 'I have that job.' },
    { role: 'user', content: 'Friday instead, 600 deep.' },
  ]);
  expect(focus).toContain('Friday instead, 600 deep.');
  expect(focus).toContain('GV-1042');
  const result = await loadRecordContext(db, 'a', ['finance'], undefined, focus);
  expect(hasKingstonJob(result.records)).toBe(true);
  expect(JSON.stringify(result.records)).not.toContain('other tenant');
});

it.each(['john', 'JOHN', 'John', 'gv-1042', 'GV-1042'])(
  'finds the same eligible record for %s',
  async (term) => {
    expect(conversationFocusTerms(`move ${term} job to friday`)).toContain(
      term.toLowerCase(),
    );
    const { db } = memoryDb(johnRecords());
    const result = await loadRecordContext(
      db,
      'a',
      ['finance'],
      undefined,
      `move ${term} job to friday`,
    );
    expect(hasKingstonJob(result.records)).toBe(true);
    expect(JSON.stringify(result.records)).not.toContain('other tenant');
  },
);

it('keeps the newest customer identifier when earlier turns already fill the term budget', () => {
  const older = Array.from(
    { length: 8 },
    (_, i) => `Quote AB-${1000 + i} for Acme job ${i}.`,
  );
  const terms = conversationFocusTerms(
    [...older, "move john's job instead"].join('\n'),
  );
  expect(terms[0]).toBe('john');
  expect(terms).toContain('john');
});

it('keeps the named customer when earlier refs in the same turn fill a naive budget', () => {
  const terms = conversationFocusTerms(
    "ignore AB-1000, AB-1001 and AB-1002; move john's job instead",
  );
  expect(terms[0]).toBe('john');
  expect(terms).toContain('john');
});

it('does not let generic words crowd out a real customer identifier', async () => {
  const generic =
    'please quote the customer about the trench and move the job around the site';
  expect(conversationFocusTerms(`${generic} for john`)).toEqual(['john']);
  expect(conversationFocusTerms(generic)).not.toContain('quote');
  expect(conversationFocusTerms(generic)).not.toContain('customer');
  expect(conversationFocusTerms(generic)).not.toContain('trench');
  expect(conversationFocusTerms(generic)).not.toContain('about');
  expect(conversationFocusTerms(generic)).not.toContain('move');
  expect(conversationFocusTerms(generic)).not.toContain('job');
  const { db } = memoryDb(johnRecords());
  const result = await loadRecordContext(
    db,
    'a',
    ['finance'],
    undefined,
    `${generic} for john`,
  );
  expect(hasKingstonJob(result.records)).toBe(true);
});

it('keeps two similar recurring jobs that share a title and body prefix', async () => {
  const prefix = `${'Recurring hydrovac trench template. Standard access notes. '.repeat(2)}`;
  expect(prefix.length).toBeGreaterThan(80);
  const expenses = Array.from({ length: 15 }, (_, i) => ({
    id: `exp-${i}`,
    workspace_id: 'a',
    status: 'active',
    kind: 'expense',
    title: `Fuel ${i}`,
    body: 'AUD 40',
    source: 'owner_supplied',
    created_at: `2026-09-${String(i + 1).padStart(2, '0')}`,
  }));
  const { db } = memoryDb({
    business_records: [
      ...expenses,
      {
        id: 'job-mary',
        workspace_id: 'a',
        status: 'active',
        kind: 'job',
        title: 'Recurring trench',
        body: `${prefix}Mary Smith, Queanbeyan. Spoil on site.`,
        source: 'owner_supplied',
        created_at: '2026-08-02',
      },
      {
        id: 'job-john',
        workspace_id: 'a',
        status: 'active',
        kind: 'job',
        title: 'Recurring trench',
        body: `${prefix}John Hale, Kingston. Live power nearby.`,
        source: 'owner_supplied',
        created_at: '2026-08-01',
      },
    ],
  });
  const result = await loadRecordContext(
    db,
    'a',
    ['finance'],
    undefined,
    'John called and Mary called.',
  );
  const bodies = result.records.map((record) =>
    typeof record === 'object' && record && 'body' in record
      ? String(record.body)
      : '',
  );
  expect(bodies.some((body) => body.includes('John Hale'))).toBe(true);
  expect(bodies.some((body) => body.includes('Mary Smith'))).toBe(true);
  expect(JSON.stringify(result.records)).not.toContain('"id"');
});

it('keeps the older John job when newer leftover refs would fill the focused result cap', async () => {
  const abJobs = Array.from({ length: 8 }, (_, i) => ({
    id: `ab-${i}`,
    workspace_id: 'a',
    status: 'active',
    kind: 'job',
    title: `Quote AB-1000 site ${i}`,
    body: `AB-1001 leftover ${i}`,
    source: 'owner_supplied',
    created_at: `2026-08-${String(10 + i).padStart(2, '0')}`,
  }));
  const { db } = memoryDb({
    business_records: [...johnRecords().business_records, ...abJobs],
  });
  const result = await loadRecordContext(
    db,
    'a',
    ['finance'],
    undefined,
    "ignore AB-1000, AB-1001 and AB-1002; move john's job instead",
  );
  expect(hasKingstonJob(result.records)).toBe(true);
  expect(JSON.stringify(result.records)).not.toContain('other tenant');
});

it('still retrieves a later exact job ref when the first cue already has eight matches', async () => {
  const johnJobs = Array.from({ length: 8 }, (_, i) => ({
    id: `john-${i}`,
    workspace_id: 'a',
    status: 'active',
    kind: 'job',
    title: `John site ${i}`,
    body: 'John quoted a small job. No GV ref.',
    source: 'owner_supplied',
    created_at: `2026-08-${String(10 + i).padStart(2, '0')}`,
  }));
  const { db } = memoryDb({
    business_records: [...johnRecords().business_records, ...johnJobs],
  });
  expect(conversationFocusTerms("move john's GV-1042 job instead")[0]).toBe(
    'john',
  );
  const result = await loadRecordContext(
    db,
    'a',
    ['finance'],
    undefined,
    "move john's GV-1042 job instead",
  );
  expect(hasKingstonJob(result.records)).toBe(true);
  expect(JSON.stringify(result.records)).not.toContain('other tenant');
});

it('extracts identifiers past the first 400 characters of a long user turn', async () => {
  const paste = `${'x'.repeat(420)} move John's job instead`;
  expect(paste.length).toBeGreaterThan(400);
  expect(paste.slice(0, 400)).not.toContain('John');
  const focus = recentUserFocusText([{ role: 'user', content: paste }]);
  expect(focus).toContain("move John's job instead");
  expect(conversationFocusTerms(focus)).toContain('john');
  const { db } = memoryDb(johnRecords());
  const result = await loadRecordContext(db, 'a', ['finance'], undefined, focus);
  expect(hasKingstonJob(result.records)).toBe(true);
});

it('still finds an older GV-1042 job when the newest fifteen already mention that ref', async () => {
  const notes = Array.from({ length: 15 }, (_, i) => ({
    id: `note-gv-${i}`,
    workspace_id: 'a',
    status: 'active',
    kind: 'note',
    title: `Follow-up GV-1042 ${i}`,
    body: 'Internal note repeating GV-1042.',
    source: 'owner_supplied',
    created_at: `2026-09-${String(i + 1).padStart(2, '0')}`,
  }));
  const extras = johnRecords().business_records.filter(
    (row) => row.id === 'job-john' || row.id === 'job-other-tenant',
  );
  const { db } = memoryDb({
    business_records: [...notes, ...extras],
  });
  const result = await loadRecordContext(
    db,
    'a',
    ['finance'],
    undefined,
    'move GV-1042 to friday',
  );
  expect(hasKingstonJob(result.records)).toBe(true);
  expect(JSON.stringify(result.records)).not.toContain('other tenant');
});
