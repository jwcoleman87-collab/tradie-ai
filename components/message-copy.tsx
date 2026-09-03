import { ChevronDown, ExternalLink, Globe2, ShieldCheck } from 'lucide-react';

const markdownLink = /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g;
const researchBlock =
  /\n\nSources — live web research \(([^)\n]+)\):\n([\s\S]+)$/;

type DisplaySource = { title: string; url: string; hostname: string };

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function sourceOf(line: string): DisplaySource | null {
  const match = line.match(
    /^\s*-\s*\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)\s*$/,
  );
  if (!match) return null;
  const url = safeLink(match[2]);
  if (!url) return null;
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  return {
    title: /^web source$/i.test(match[1].trim()) ? hostname : match[1],
    url,
    hostname,
  };
}

export function parseResearchMessage(text: string) {
  const match = text.match(researchBlock);
  if (!match)
    return { body: text, searchedAt: null, sources: [] as DisplaySource[] };

  const sources = match[2]
    .split('\n')
    .map(sourceOf)
    .filter((source): source is DisplaySource => Boolean(source));
  if (!sources.length)
    return { body: text, searchedAt: null, sources: [] as DisplaySource[] };

  // Providers sometimes repeat a plain-text source list before the app adds
  // its verified citation block. Keep the answer and one clean source list.
  const body = text
    .slice(0, match.index)
    .split(/\n{2,}/)
    .filter((paragraph) => !/^Sources:\s*\n\s*-\s+/i.test(paragraph))
    .join('\n\n')
    .trim();
  return { body, searchedAt: match[1], sources };
}

function linkedText(text: string) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(markdownLink)) {
    const index = match.index;
    if (index > cursor) parts.push(text.slice(cursor, index));
    const href = safeLink(match[2]);
    parts.push(
      href ? (
        <a
          key={`${index}:${href}`}
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {match[1]}
        </a>
      ) : (
        match[0]
      ),
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function MessageCopy({ text }: { text: string }) {
  const research = parseResearchMessage(text);
  return (
    <div className="message-copy">
      <div className="message-body">{linkedText(research.body)}</div>
      {research.sources.length > 0 && (
        <details className="research-sources">
          <summary>
            <span className="research-source-icon" aria-hidden="true">
              <Globe2 size={17} />
            </span>
            <span className="research-source-summary">
              <strong>Sources checked</strong>
              <small>{research.sources.length} live web sources</small>
            </span>
            <ChevronDown className="research-source-chevron" size={17} />
          </summary>
          <div className="research-source-list">
            {research.sources.map((source, index) => (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                key={source.url}
              >
                <span className="research-source-number">{index + 1}</span>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.hostname}</small>
                </span>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
          <p className="research-safety-note">
            <ShieldCheck size={14} /> Live information only — no action was
            taken.
          </p>
        </details>
      )}
    </div>
  );
}
