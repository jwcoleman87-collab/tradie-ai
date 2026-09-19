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
import { type BrandId } from '@/lib/brands';
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
  allowCollapse = true,
}: {
  field: Field;
  kind: ReplySection['kind'];
  allowCollapse?: boolean;
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
    allowCollapse && field.value.length > 170 ? (
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
  allowCollapse = true,
}: {
  blocks: ReplyBlock[];
  kind: ReplySection['kind'];
  allowCollapse?: boolean;
}) {
  return blocks.map((block, index) => {
    if (block.kind === 'field')
      return (
        <dl className="chat-reply-fields" key={index}>
          <ReplyField field={block} kind={kind} allowCollapse={allowCollapse} />
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

function ReplySectionView({
  section,
  primary,
}: {
  section: ReplySection;
  primary: boolean;
}) {
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
  const [open, setOpen] = useState(false);
  const heading = (
    <span className="chat-reply-section-title">
      <Icon size={16} aria-hidden="true" />
      {title}
    </span>
  );
  const content = (
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
      <Blocks
        blocks={otherBlocks}
        kind={section.kind}
        allowCollapse={!primary}
      />
    </div>
  );
  if (primary) {
    // A plain conversational answer reads as prose, with no surrounding card or
    // repeated title. Structured briefs keep their heading.
    const bare = section.kind === 'answer';
    return (
      <section
        className="chat-reply-section"
        data-kind={section.kind}
        data-primary="true"
        data-bare={bare || undefined}
        aria-label={section.title}
      >
        {!bare && <h3 className="chat-reply-primary-title">{heading}</h3>}
        {content}
      </section>
    );
  }
  return (
    <details
      className="chat-reply-section"
      data-kind={section.kind}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={section.title}>
        {heading}
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      {content}
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
  showActions = false,
  actionsEnabled = false,
  onChoosePrompt,
}: {
  text: string;
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
  const primarySection = sections.find((section) => section.blocks.length > 0);
  const orderedSections = primarySection
    ? [
        primarySection,
        ...sections.filter((section) => section !== primarySection),
      ]
    : sections;
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
      {coverage && (
        <div className="chat-reply-coverage">
          <MessageCopy text={coverage[0]} />
        </div>
      )}
      <div className="chat-reply-sections">
        {orderedSections.map((section) => (
          <ReplySectionView
            key={section.id}
            section={section}
            primary={section === primarySection}
          />
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
