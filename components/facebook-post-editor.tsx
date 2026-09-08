'use client';

import { useId, useState } from 'react';
import { FacebookPayload } from '@/lib/contracts';
import { Button } from './workbench-controls';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';

export type FacebookPostEdit = { message: string; link: string | null };

export function FacebookPostEditor({
  payload,
  disabled,
  onSave,
  onCancel,
}: {
  payload: Record<string, unknown>;
  disabled: boolean;
  onSave: (edit: FacebookPostEdit) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [message, setMessage] = useState(
    typeof payload.message === 'string' ? payload.message : '',
  );
  const [link, setLink] = useState(
    typeof payload.link === 'string' ? payload.link : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locked = disabled || saving;
  return (
    <form
      className="facebook-post-editor"
      aria-label="Edit Facebook post"
      onSubmit={async (event) => {
        event.preventDefault();
        if (locked) return;
        const result = FacebookPayload.safeParse({
          ...payload,
          message,
          link: payload.imageFileId ? null : link.trim() || null,
        });
        if (!result.success) {
          setError(
            'Enter a caption of 1–5,000 characters and an optional HTTPS link.',
          );
          return;
        }
        setError('');
        setSaving(true);
        try {
          await onSave({
            message: result.data.message,
            link: result.data.link,
          });
          onCancel();
        } catch (reason) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Changes could not be saved. Try again.',
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <label htmlFor={`${id}-caption`}>Post text</label>
      <Textarea
        id={`${id}-caption`}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={5000}
        rows={6}
        required
        disabled={locked}
      />
      {!payload.imageFileId && (
        <>
          <label htmlFor={`${id}-link`}>Link (optional)</label>
          <Input
            id={`${id}-link`}
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://"
            maxLength={2000}
            disabled={locked}
          />
        </>
      )}
      <p className="auth-hint">
        Save your changes, review the updated post, then Approve to publish.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="action-buttons">
        <Button
          type="button"
          variant="outline"
          disabled={locked}
          onClick={onCancel}
        >
          Cancel edit
        </Button>
        <Button type="submit" disabled={locked || !message.trim()}>
          {saving ? 'Saving changes…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
