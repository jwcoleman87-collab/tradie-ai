'use client';

import { memo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  ContactRound,
  FilePenLine,
  FileText,
  FolderOpen,
  Globe,
  HelpCircle,
  Link,
  Megaphone,
  MessageSquare,
  PanelsTopLeft,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import { BrandMark } from './brand';
import { Button } from './workbench-controls';
import { MessageCopy, parseResearchMessage } from './message-copy';
import { findWorkspaceBrand, type BrandId } from '@/lib/brands';
import {
  parseChatSections,
  type ReplyBlock,
  type ReplySection,
} from '@/lib/chat-presentation';
import {
  chatReplyActions,
  type ChatReplyActionId,
} from '@/lib/chat-reply-actions';

const sectionIcons = {
  business: Building2,
  connections: Link,
  rates: Receipt,
  records: FolderOpen,
  rules: ShieldCheck,
  gaps: HelpCircle,
  next: ClipboardList,
  answer: MessageSquare,
};
const actionIcons = {
  profile: ContactRound,
  job: ClipboardList,
  quote: FileText,
  variation: FilePenLine,
  booking: CalendarDays,
  facebook: PanelsTopLeft,
  website: Globe,
  campaign: Megaphone,
};
const connectionBrands: Record<string, BrandId> = {
  'google calendar': 'google_calendar',
  facebook: 'facebook',
  'facebook page': 'facebook',
  'google ads': 'google_ads',
};

type Field = Extract<ReplyBlock, { kind: 'field' }>;

function metric(field: Field) {
  if (
    !/^(?:minimum charge|hourly on[- ]site rate|on[- ]site hourly|hourly rate|after[- ]hours rate)$/i.test(
      field.label,
    )
  )
    return null;
  const match = field.value.match(
    /^((?:AUD\s*|\$\s*)\d[\d,.]*|\d+(?:\.\d+)?\s*[×x])(?=\s|$|[.;,])([\s\S]*)$/,
  );
  return match ? { amount: match[1], qualifier: match[2].trim() } : null;
}

function ReplyField({
  field,
  kind,
}: {
  field: Field;
  kind: ReplySection['kind'];
}) {
  const brand =
    kind === 'connections'
      ? connectionBrands[field.label.toLowerCase()]
      : undefined;
  const connectionStatus = /^not connected\b/i.test(field.value)
    ? { label: 'Not connected', state: 'disconnected' }
    : /^connected[.!]?$/i.test(field.value.trim())
      ? { label: 'Connected', state: 'connected' }
      : null;
  const contents = <MessageCopy text={field.value} />;
  const display =
    field.value.length > 170 ? (
      <details className="chat-reply-field-detail">
        <summary>
          View {field.label.toLowerCase()}{' '}
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        {contents}
      </details>
    ) : (
      contents
    );
  return brand ? (
    <div className="chat-reply-connection">
      <BrandMark brand={brand} compact />
      <div>
        <dt>{field.label}</dt>
        <dd>{display}</dd>
      </div>
      {connectionStatus && (
        <span className="chat-reply-status" data-state={connectionStatus.state}>
          {connectionStatus.label}
        </span>
      )}
    </div>
  ) : (
    <div className="chat-reply-field">
      <dt>{field.label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

function Blocks({
  blocks,
  kind,
}: {
  blocks: ReplyBlock[];
  kind: ReplySection['kind'];
}) {
  return blocks.map((block, index) => {
    if (block.kind === 'field')
      return (
        <dl className="chat-reply-fields" key={index}>
          <ReplyField field={block} kind={kind} />
        </dl>
      );
    if (block.kind === 'list')
      return (
        <ul className="chat-reply-list" key={index}>
          {block.items.map((item, i) => (
            <li key={i}>
              <MessageCopy text={item} />
            </li>
          ))}
        </ul>
      );
    return (
      <div className="chat-reply-text" key={index}>
        <MessageCopy text={block.text} />
      </div>
    );
  });
}

function ReplySectionView({ section }: { section: ReplySection }) {
  const Icon = sectionIcons[section.kind];
  const metricFields = section.blocks.flatMap((block) =>
    block.kind === 'field' && metric(block) ? [block] : [],
  );
  const otherBlocks = section.blocks.filter(
    (block) => !metricFields.includes(block as Field),
  );
  const title = {
    business: 'Your business',
    connections: 'Connections',
    rates: 'Rates & conditions',
    rules: metricFields.length ? 'Rates & job rules' : 'Job rules',
    records: 'Records',
    gaps: 'Information needed',
    next: 'Suggested next steps',
    answer: section.title,
  }[section.kind];
  const [open, setOpen] = useState(
    section.kind !== 'next' &&
      section.kind !== 'gaps' &&
      (section.kind !== 'rules' || metricFields.length > 0),
  );
  return (
    <details
      className="chat-reply-section"
      data-kind={section.kind}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={section.title}>
        <span className="chat-reply-section-title">
          <Icon size={16} aria-hidden="true" />
          {title}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="chat-reply-section-body">
        {metricFields.length > 0 && (
          <dl className="chat-reply-metrics">
            {metricFields.map((field, index) => {
              const value = metric(field)!;
              return (
                <div className="chat-reply-metric" key={index}>
                  <dt>{field.label}</dt>
                  <dd className="chat-reply-amount">{value.amount}</dd>
                  {value.qualifier && (
                    <dd className="chat-reply-qualifier">
                      <MessageCopy text={value.qualifier} />
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>
        )}
        <Blocks blocks={otherBlocks} kind={section.kind} />
      </div>
    </details>
  );
}

function ReplyActions({
  onChoose,
  disabled,
}: {
  onChoose: (prompt: string) => boolean;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<ChatReplyActionId | null>(null);
  return (
    <section
      className="chat-reply-action-panel"
      aria-label="Prepare your next request"
    >
      <header>
        <h3>What would you like to prepare?</h3>
        <p>Choose a request, add your details, then send it to Chat.</p>
      </header>
      <div className="chat-reply-action-groups">
        {chatReplyActions.map((group) => (
          <section key={group.group} aria-label={group.group}>
            <h4>{group.group}</h4>
            {group.actions.map((action) => {
              const Icon = actionIcons[action.id];
              return (
                <Button
                  key={action.id}
                  type="button"
                  variant="outline"
                  className="chat-reply-action"
                  data-selected={selected === action.id}
                  disabled={disabled}
                  onClick={() => {
                    if (onChoose(action.prompt)) setSelected(action.id);
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  {action.label}
                </Button>
              );
            })}
          </section>
        ))}
      </div>
      <p className="chat-reply-action-help" aria-live="polite">
        {selected
          ? 'Request added to your message. Review it before sending.'
          : 'These buttons prepare a request. They do not book, save or publish.'}
      </p>
    </section>
  );
}

/** Renders saved reply content only; presentation never supplies business facts. */
export const ChatReply = memo(function ChatReply({
  text,
  workspaceName,
  showActions = false,
  actionsEnabled = false,
  onChoosePrompt,
}: {
  text: string;
  workspaceName: string;
  showActions?: boolean;
  actionsEnabled?: boolean;
  onChoosePrompt?: (prompt: string) => boolean;
}) {
  const research = parseResearchMessage(text);
  const coverage = research.body.match(/^Data coverage: ([^\n]+)\n\n/);
  const body = coverage
    ? research.body.slice(coverage[0].length)
    : research.body;
  const sections = parseChatSections(body);
  const compact = sections.length === 1 && body.length < 400;
  const overview = sections.some((section) => section.kind === 'business');
  const hasNext = sections.some((section) => section.kind === 'next');
  const sourcesOnly =
    research.sources.length > 0
      ? `\n\nSources — live web research (${research.searchedAt}):\n${research.sources.map((source) => `- [${source.title}](${source.url})`).join('\n')}`
      : '';
  const actions =
    showActions && onChoosePrompt ? (
      <ReplyActions onChoose={onChoosePrompt} disabled={!actionsEnabled} />
    ) : null;
  return (
    <div className="chat-reply" data-compact={compact}>
      {!compact && (
        <div className="chat-reply-heading">
          <div className="chat-reply-identity">
            {overview && (
              <BrandMark
                brand={findWorkspaceBrand(workspaceName)}
                alt={workspaceName}
                compact
              />
            )}
            <span>{overview ? workspaceName : 'Your crew'}</span>
          </div>
          <span className="chat-reply-label">
            {overview ? 'Business brief' : 'Chat brief'}
          </span>
        </div>
      )}
      {coverage && (
        <div className="chat-reply-coverage">
          <MessageCopy text={coverage[0]} />
        </div>
      )}
      <div className="chat-reply-sections">
        {sections.map((section) => (
          <ReplySectionView key={section.id} section={section} />
        ))}
      </div>
      {sourcesOnly && <MessageCopy text={sourcesOnly} />}
      {actions &&
        (overview || hasNext ? (
          actions
        ) : (
          <details className="chat-reply-tools">
            <summary>
              Prepare something else{' '}
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            {actions}
          </details>
        ))}
    </div>
  );
});
