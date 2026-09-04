import { api } from '@/lib/server/api';
export const dynamic = 'force-dynamic';
// The 120-second Chat deadline leaves time to persist its result before the host stops execution.
export const maxDuration = 150;
export const GET = api;
export const POST = api;
export const PATCH = api;
