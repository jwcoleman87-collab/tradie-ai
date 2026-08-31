import { CalendarPayload } from '../contracts';
import { adminDb, checked } from './db';
import { decrypt } from './crypto';
import { required } from './config';
import { AppError, timedFetch } from './errors';

async function accessToken(workspaceId: string, connectionId?: string) {
  const db = adminDb();
  let query = db
    .from('integration_credentials')
    .select('encrypted_refresh_token')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'google_calendar')
    .eq('status', 'connected');
  if (connectionId) query = query.eq('connection_id', connectionId);
  const connection = checked(await query.maybeSingle());
  if (!connection)
    throw new AppError(
      'CALENDAR_NOT_CONNECTED',
      409,
      'Connect Google Calendar, then retry this approved action.',
    );
  const refreshToken = await decrypt(
    connection.encrypted_refresh_token,
    workspaceId,
  );
  const response = await timedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: required('GOOGLE_CLIENT_ID'),
      client_secret: required('GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok)
    throw new AppError(
      'RECONNECT_REQUIRED',
      409,
      'Please reconnect Google Calendar.',
    );
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new AppError('RECONNECT_REQUIRED', 409);
  return data.access_token;
}
export const calendarEventId = (actionId: string) =>
  actionId.replaceAll('-', '').toLowerCase();
export async function createCalendarEvent(
  workspaceId: string,
  actionId: string,
  payload: unknown,
  connectionId: string,
) {
  const event = CalendarPayload.parse(payload),
    token = await accessToken(workspaceId, connectionId),
    id = calendarEventId(actionId);
  const base =
    'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  let response = await timedFetch(`${base}?sendUpdates=none`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id,
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start, timeZone: event.timeZone },
      end: { dateTime: event.end, timeZone: event.timeZone },
      extendedProperties: { private: { tradieActionId: actionId } },
      reminders: { useDefault: false },
    }),
  });
  // A deterministic Google event ID reconciles retries after network uncertainty.
  if (response.status === 409)
    response = await timedFetch(`${base}/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  if (!response.ok)
    throw new AppError(
      'CALENDAR_EXECUTION_FAILED',
      503,
      'Google Calendar did not confirm the booking. Retry safely from this action.',
    );
  const result = (await response.json()) as {
    id: string;
    status?: string;
    htmlLink?: string;
    extendedProperties?: { private?: { tradieActionId?: string } };
  };
  if (
    result.status === 'cancelled' ||
    result.extendedProperties?.private?.tradieActionId !== actionId ||
    result.id !== id
  )
    throw new AppError(
      'CALENDAR_RECONCILIATION_REQUIRED',
      409,
      'This booking needs review before retrying.',
    );
  return {
    provider: 'google_calendar',
    eventId: result.id,
    url:
      result.htmlLink?.startsWith('https://www.google.com/calendar/') ||
      result.htmlLink?.startsWith('https://calendar.google.com/')
        ? result.htmlLink
        : null,
  };
}
export async function calendarContext(workspaceId: string) {
  try {
    const token = await accessToken(workspaceId);
    const params = new URLSearchParams({
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 14 * 86400000).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
      fields: 'items(start,end,status),nextPageToken',
    });
    const response = await timedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return { available: false };
    const data = (await response.json()) as {
      items: unknown[];
      nextPageToken?: string;
    };
    return {
      available: true,
      coverage:
        'Primary calendar only, next 14 days. Other calendars and dates are unverified.',
      truncated: !!data.nextPageToken,
      busy: data.items,
    };
  } catch {
    return {
      available: false,
      note: 'Do not claim the calendar is free. Availability is unverified.',
    };
  }
}
