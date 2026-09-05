import { expect, it } from 'vitest';
import {
  financeDisclosure,
  loadRecordContext,
} from '../lib/server/record-context';
import { memoryDb } from './fixtures/memory-db';

it('discloses 15 of 63 records and every shortened body without claiming period coverage', async () => {
  const rows = Array.from({ length: 63 }, (_, i) => ({
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
      { ...rows[0], workspace_id: 'b' },
      { ...rows[0], status: 'archived' },
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
});
it('allows Social to use saved jobs, and never equates all stored rows to complete books', async () => {
  const { db } = memoryDb({
    business_records: [
      {
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
