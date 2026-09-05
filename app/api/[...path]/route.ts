import { after } from 'next/server';
import { createApi } from '@/lib/server/api';
// Keep the same execution alive if the browser disconnects. This is bounded
// by the host duration; durable action state still exposes interrupted work.
const api = createApi((execution) =>
  after(async () => {
    await execution.catch(() => {}); // The API records/reports the same failure.
  }),
);
export const dynamic = 'force-dynamic';
// The 120-second Chat deadline leaves time to persist its result before the host stops execution.
export const maxDuration = 150;
export const GET = api;
export const POST = api;
export const PATCH = api;
