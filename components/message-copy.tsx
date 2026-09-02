const markdownLink = /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g;

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

export function MessageCopy({ text }: { text: string }) {
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
  return <div className="message-copy">{parts}</div>;
}
