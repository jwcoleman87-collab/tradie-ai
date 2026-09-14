import { describe, expect, it } from 'vitest';
import {
  draftSections,
  proposalImage,
  referencedImageUploads,
} from '../lib/proposal-presentation';
import type { Action, Upload } from '../lib/contracts';

const id = '1ba9bded-cff9-4bd8-ab78-201fa407d0bd';
const upload: Upload = {
  id,
  filename: 'franchise-post.png',
  mime_type: 'image/png',
  size_bytes: 2048,
  status: 'ready',
};
const body = `Caption:\r\nFirst paragraph: a new service.\r\n\r\nSecond paragraph.\r\n\r\nImage: trusted file ID ${id}\r\n\r\nNotes:\r\n- Confirm image permission.\r\n  This is still required.\r\n- Save privately.`;
const action = (text = body) =>
  ({
    action_type: 'draft.save',
    payload: { kind: 'social', title: 'Trial post', body: text },
  }) as Pick<Action, 'action_type' | 'payload'>;

describe('proposal presentation', () => {
  it('keeps caption paragraphs, colons, notes and their continuation lines', () => {
    expect(draftSections(body)).toEqual({
      structured: true,
      caption: 'First paragraph: a new service.\n\nSecond paragraph.',
      imageReference: `trusted file ID ${id}`,
      notes:
        '- Confirm image permission.\n  This is still required.\n- Save privately.',
    });
  });
  it('keeps unstructured, duplicate and out-of-order content intact', () => {
    for (const text of [
      'A note mentioning Caption: in prose.',
      'Caption: one\n\nCaption: two',
      'Caption: one\n\nNotes: review\n\nImage: image.png',
    ]) {
      expect(draftSections(text)).toMatchObject({
        structured: false,
        caption: text,
      });
    }
  });
  it('keeps unfamiliar content instead of discarding it', () => {
    const text = 'Caption: Hello\n\nCampaign terms:\nKeep this detail.';
    expect(draftSections(text).caption).toBe(
      'Hello\n\nCampaign terms:\nKeep this detail.',
    );
  });
  it('only resolves an explicitly referenced, available ready image', () => {
    expect(proposalImage(action(), [upload])).toBe(upload);
    expect(proposalImage(action(), [])).toBeUndefined();
    expect(
      proposalImage(action(), [{ ...upload, status: 'pending' }]),
    ).toBeUndefined();
    expect(
      proposalImage(action(), [{ ...upload, mime_type: 'application/pdf' }]),
    ).toBeUndefined();
    expect(
      proposalImage(
        action(`Caption: Reference ${id}\n\nNotes: use image ${id}`),
        [upload],
      ),
    ).toBeUndefined();
    expect(
      proposalImage(
        action(body.replace('trusted file ID', 'https://untrusted.test/')),
        [upload],
      ),
    ).toBeUndefined();
  });
  it('resolves the same trusted image reference in every proposal kind', () => {
    expect(
      proposalImage({ ...action(), action_type: 'record.create' }, [upload]),
    ).toBe(upload);
  });
  it('resolves an image mentioned in an ordinary assistant reply', () => {
    const reply = `Suggested caption (ready to publish):\nA finished caption.\n\nImage to use (you uploaded): trusted file ID ${id}\nFacebook Page available here: GreenVac.`;
    expect(referencedImageUploads(reply, [upload])).toEqual([upload]);
  });
  it('resolves exact filenames but never unknown, pending or non-image files', () => {
    expect(referencedImageUploads('Use franchise-post.png', [upload])).toEqual([
      upload,
    ]);
    expect(
      referencedImageUploads(`Use ${id}`, [
        { ...upload, status: 'pending' },
        { ...upload, id: crypto.randomUUID(), mime_type: 'application/pdf' },
      ]),
    ).toEqual([]);
    expect(
      referencedImageUploads(`Use ${crypto.randomUUID()}`, [upload]),
    ).toEqual([]);
  });
});
