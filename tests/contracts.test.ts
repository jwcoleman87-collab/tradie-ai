import { describe, it, expect } from 'vitest';
import { CalendarPayload, Proposal, ChatInput } from '../lib/contracts';
import { supportPayload } from '../lib/server/privacy';
import {
  prepareUpload,
  validateFile,
  safeFilename,
} from '../lib/server/uploads';
import { uploadMime } from '../lib/upload-mime';
import { calendarEventId } from '../lib/server/calendar';
const event = {
  summary: 'Service',
  description: '500-hour service',
  start: '2026-09-04T09:00:00+10:00',
  end: '2026-09-04T11:00:00+10:00',
  timeZone: 'Australia/Sydney',
};
describe('approval contracts', () => {
  it('allows a complete calendar proposal', () =>
    expect(CalendarPayload.parse(event)).toEqual(event));
  it.each([
    { ...event, end: event.start },
    { ...event, start: 'Friday 9am' },
    { ...event, timeZone: 'Made/Up' },
    { ...event, start: '2026-09-04T09:00:00' },
    { ...event, attendees: ['someone@example.test'] },
  ])('rejects unsafe or ambiguous event %#', (value) =>
    expect(CalendarPayload.safeParse(value).success).toBe(false),
  );
  it('rejects arbitrary execution types', () =>
    expect(
      Proposal.safeParse({
        type: 'money.transfer',
        summary: 'pay',
        agent: 'finance',
        payload: {},
      }).success,
    ).toBe(false));
  it('rejects client-supplied approval', () =>
    expect(
      Proposal.safeParse({
        type: 'calendar.create',
        summary: 'service',
        agent: 'maintenance',
        payload: event,
        approved: true,
      }).success,
    ).toBe(false));
  it('rejects malformed tenant identifiers', () =>
    expect(
      ChatInput.safeParse({
        workspaceId: '*',
        conversationId: '*',
        requestId: '*',
        text: 'test',
      }).success,
    ).toBe(false));
  it('allows an attachment-only chat but not an empty message', () => {
    const identifiers = {
      workspaceId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
    };
    expect(
      ChatInput.parse({
        ...identifiers,
        text: '   ',
        attachmentIds: [crypto.randomUUID()],
      }).text,
    ).toBe('');
    expect(
      ChatInput.safeParse({ ...identifiers, text: '', attachmentIds: [] })
        .success,
    ).toBe(false);
  });
  it('creates a stable valid Google event ID', () => {
    const id = calendarEventId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(id).toBe('aaaaaaaabbbbccccddddeeeeeeeeeeee');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});
describe('privacy and files', () => {
  it('support payload has no customer text fields', () => {
    const p = supportPayload('CASE-000001', 'finance', 'general');
    expect(Object.keys(p).sort()).toEqual(
      [
        'schemaVersion',
        'caseId',
        'agent',
        'category',
        'problem',
        'solution',
        'outcome',
      ].sort(),
    );
    expect(p.problem).not.toContain('invoice');
  });
  it('unknown categories cannot smuggle text', () =>
    expect(
      JSON.stringify(
        supportPayload('CASE-1', 'social', 'Jane Smith 1 Main Street secret'),
      ),
    ).not.toContain('Jane'));
  it('validates file signatures', () => {
    expect(() =>
      validateFile(new Uint8Array([255, 216, 255, 0]), 'image/jpeg'),
    ).not.toThrow();
    expect(() =>
      validateFile(
        new TextEncoder().encode('<script>alert(1)</script>'),
        'image/jpeg',
      ),
    ).toThrow();
  });
  it('rejects SVG and active HTML', () => {
    expect(() =>
      validateFile(new TextEncoder().encode('<svg/>'), 'image/svg+xml'),
    ).toThrow();
    expect(() =>
      validateFile(new TextEncoder().encode('<html>oops'), 'text/plain'),
    ).toThrow();
  });
  it('rejects oversize and empty files', () => {
    expect(() => validateFile(new Uint8Array(0), 'text/plain')).toThrow();
    expect(() =>
      validateFile(new Uint8Array(10485761), 'text/plain'),
    ).toThrow();
  });
  it('accepts valid text and PDFs', () => {
    expect(() =>
      validateFile(
        new TextEncoder().encode('hours,service\n250,done'),
        'text/csv',
      ),
    ).not.toThrow();
    expect(() =>
      validateFile(new TextEncoder().encode('%PDF-1.7'), 'application/pdf'),
    ).not.toThrow();
  });
  it('normalises path traversal filenames', () =>
    expect(safeFilename('../../secret.html')).not.toContain('/'));
  it('recovers browser MIME types from common photo extensions', () => {
    expect(uploadMime('IMG_1001.HEIC')).toBe('image/heic');
    expect(uploadMime('site.JPG', 'image/jpg')).toBe('image/jpeg');
    expect(uploadMime('photo.webp', 'application/octet-stream')).toBe(
      'image/webp',
    );
  });
  it('converts a HEIF-family phone photo into a previewable JPEG', async () => {
    const heifFixture = Uint8Array.from(
      Buffer.from(
        'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACcAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAvbWRhdBIACgc4ADaQENBpMhoTwmMmgADwgAAAAEhZFD/7xHaYtqZTYOwWsA==',
        'base64',
      ),
    );
    const prepared = await prepareUpload(
      heifFixture,
      'IMG_1001.HEIC',
      'image/heic',
    );
    expect(prepared).toMatchObject({
      filename: 'IMG_1001.jpg',
      mime: 'image/jpeg',
    });
    expect(prepared.bytes.slice(0, 3)).toEqual(
      Uint8Array.from([255, 216, 255]),
    );
  });
});
