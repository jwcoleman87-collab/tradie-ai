import type { ReactNode } from 'react';
import {
  Camera,
  ChevronDown,
  FilePenLine,
  FileText,
  ListChecks,
  LockKeyhole,
} from 'lucide-react';
import { draftSections } from '@/lib/proposal-presentation';

function PreviewCopy({
  text,
  notes = false,
}: {
  text: string;
  notes?: boolean;
}) {
  return text
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block, index) => {
      if (notes && /^\s*[-*] /.test(block)) {
        const items = block.split(/\n(?=\s*[-*] )/);
        return (
          <ul key={index}>
            {items.map((item, i) => (
              <li key={i}>{item.replace(/^\s*[-*] /, '')}</li>
            ))}
          </ul>
        );
      }
      return <p key={index}>{block}</p>;
    });
}

export function RecordPreview({
  title,
  summary,
  body,
  kind,
  businessName,
  draft,
  image,
  imageName,
}: {
  title: string;
  summary: string;
  body: string;
  kind: string;
  businessName: string;
  draft: boolean;
  image?: ReactNode;
  imageName?: string;
}) {
  const sections = draft
    ? draftSections(body)
    : { structured: false, caption: body, notes: '', imageReference: '' };
  const Icon = draft ? FilePenLine : FileText;
  return (
    <section
      className="record-preview"
      data-kind={kind}
      aria-label={draft ? 'Draft preview' : 'Record preview'}
    >
      <header className="record-preview-heading">
        <span className="record-preview-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <div className="record-preview-identity">
          <span>{draft ? 'Draft preview' : 'Record preview'}</span>
          <strong>{businessName}</strong>
        </div>
        <span className="record-preview-private">
          <LockKeyhole size={12} aria-hidden="true" /> Private
        </span>
      </header>
      {title.trim() !== summary.trim() && (
        <h4 className="record-preview-title">{title}</h4>
      )}
      <div className="record-preview-copy">
        <PreviewCopy text={sections.caption} />
      </div>
      {image && (
        <figure className="record-preview-image">
          {image}
          <figcaption>
            <Camera size={14} aria-hidden="true" />
            <span>{imageName || 'Attached image'}</span>
          </figcaption>
        </figure>
      )}
      {sections.imageReference && !image && (
        <div className="record-preview-attachment">
          <Camera size={18} aria-hidden="true" />
          <span>
            Image reference included
            <small>See the original draft for attachment details.</small>
          </span>
        </div>
      )}
      {sections.notes && (
        <details className="record-preview-notes">
          <summary>
            <ListChecks size={17} aria-hidden="true" />
            <span>Review notes</span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div>
            <PreviewCopy text={sections.notes} notes />
          </div>
        </details>
      )}
      {sections.structured && (
        <details className="record-preview-original">
          <summary>Original draft</summary>
          <p>{body}</p>
        </details>
      )}
      <footer className="record-preview-outcome">
        <LockKeyhole size={17} aria-hidden="true" />
        <div>
          <strong>
            {draft
              ? 'Save as a private draft'
              : 'Save to your business records'}
          </strong>
          <p>
            {draft
              ? 'Accept saves it here. Nothing is published or sent.'
              : 'Accept adds this record to your business memory.'}
          </p>
        </div>
      </footer>
    </section>
  );
}
