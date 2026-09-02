import type { AIProviderName } from '../ai-settings';
import { AppError } from './errors';

export type WebSource = { title: string; url: string };
export type WebResearch = {
  summary: string;
  sources: WebSource[];
  searchedAt: string;
  provider: AIProviderName;
};

export function publicSearchQuery(value: string | null) {
  const query = (value || '').replace(/\s+/g, ' ').trim();
  const privatePattern =
    /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|https?:\/\/|\b(?:sk-(?:proj|ant)|sb_(?:secret|publishable)|bearer)\b|(?:password|api[ _-]?key|secret|access[ _-]?token)\s*[:=]|(?:\+?\d[\d ()-]{8,}\d))/i;
  if (query.length < 3 || query.length > 300 || privatePattern.test(query))
    throw new AppError(
      'AI_RESEARCH_QUERY_PRIVATE',
      422,
      'Live research was stopped because the proposed search could contain private information. Rephrase it using only public terms.',
    );
  return query;
}

export function webSources(values: WebSource[]) {
  const seen = new Set<string>();
  const safe: WebSource[] = [];
  for (const value of values) {
    try {
      const url = new URL(value.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        continue;
      seen.add(url.href);
      safe.push({
        title:
          value.title
            .replaceAll('[', ' ')
            .replaceAll(']', ' ')
            .replaceAll('(', ' ')
            .replaceAll(')', ' ')
            .replace(/[\r\n]+/g, ' ')
            .trim()
            .slice(0, 200) || url.hostname,
        url: url.href,
      });
      if (safe.length === 8) break;
    } catch {
      /* Ignore malformed provider citations. */
    }
  }
  return safe;
}

export function requireWebResearch(
  provider: AIProviderName,
  summary: string,
  sources: WebSource[],
): WebResearch {
  const safeSources = webSources(sources);
  const safeSummary = summary.trim().slice(0, 12000);
  if (!safeSummary || !safeSources.length)
    throw new AppError(
      'AI_RESEARCH_UNAVAILABLE',
      503,
      'Live web research could not return a cited result. No actions were executed.',
    );
  return {
    summary: safeSummary,
    sources: safeSources,
    searchedAt: new Date().toISOString(),
    provider,
  };
}

export function appendWebSources(reply: string, research?: WebResearch) {
  if (!research) return reply;
  const sourceList = research.sources
    .map((source) => `- [${source.title}](${source.url})`)
    .join('\n');
  return `${reply.trim()}\n\nSources — live web research (${research.searchedAt}):\n${sourceList}`;
}
