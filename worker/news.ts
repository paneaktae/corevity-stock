import { Hono } from 'hono';
import type { AppEnv } from './auth';

type CrossrefWork = {
  DOI?: string;
  title?: string[];
  publisher?: string;
  URL?: string;
  'container-title'?: string[];
  published?: { 'date-parts'?: number[][] };
  issued?: { 'date-parts'?: number[][] };
  created?: { 'date-time'?: string };
};

export type NewsArticle = {
  id: string;
  title: string;
  publisher: string;
  publication: string;
  date: string;
  url: string;
  topic: 'training' | 'equipment';
};

type FeedTopic = NewsArticle['topic'];

function dateFromParts(parts?: number[][]): string {
  const [year, month = 1, day = 1] = parts?.[0] ?? [];
  if (!year || year < 1900 || year > 2200) return '';
  const result = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(result.valueOf()) ? '' : result.toISOString().slice(0, 10);
}

export function mapCrossrefWorks(
  works: CrossrefWork[],
  topic: FeedTopic,
): NewsArticle[] {
  return works.flatMap((work) => {
    const title = work.title?.[0]?.replace(/\s+/g, ' ').trim();
    let url: URL;
    try {
      url = new URL(work.URL ?? (work.DOI ? `https://doi.org/${work.DOI}` : ''));
    } catch {
      return [];
    }
    if (!title || url.protocol !== 'https:') return [];
    const date =
      dateFromParts(work.published?.['date-parts']) ||
      dateFromParts(work.issued?.['date-parts']) ||
      (work.created?.['date-time']?.slice(0, 10) ?? '');
    return [
      {
        id: work.DOI || url.href,
        title: title.slice(0, 400),
        publisher: (work.publisher || 'Crossref').slice(0, 120),
        publication: (work['container-title']?.[0] || '').slice(0, 160),
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
        url: url.href,
        topic,
      },
    ];
  });
}

async function fetchTopic(topic: FeedTopic, query: string): Promise<NewsArticle[]> {
  const today = new Date();
  const until = today.toISOString().slice(0, 10);
  const from = new Date(Date.UTC(today.getUTCFullYear() - 3, today.getUTCMonth(), today.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query.title', query);
  url.searchParams.set('rows', '16');
  url.searchParams.set('select', 'DOI,title,published,issued,created,publisher,URL,container-title');
  url.searchParams.set('filter', `from-pub-date:${from},until-pub-date:${until},type:journal-article`);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'CorevityFitnessManager/1.0 (mailto:analyziie@gmail.com)',
    },
    signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) throw new Error(`Crossref returned ${response.status}`);
  const payload = (await response.json()) as {
    message?: { items?: CrossrefWork[] };
  };
  return mapCrossrefWorks(payload.message?.items ?? [], topic);
}

export const newsRoutes = new Hono<AppEnv>();
const edgeCache = () => (caches as CacheStorage & { default: Cache }).default;

newsRoutes.get('/news', async (c) => {
  const cacheKey = new Request(new URL('/api/news', c.req.url), { method: 'GET' });
  const forceRefresh = c.req.query('refresh') === '1';
  if (!forceRefresh && typeof caches !== 'undefined') {
    try {
      const cached = await edgeCache().match(cacheKey);
      if (cached) return cached;
    } catch {
      // Continue to the source when the edge cache is unavailable in local development.
    }
  }

  const [training, equipment] = await Promise.allSettled([
    fetchTopic('training', 'exercise training fitness'),
    fetchTopic('equipment', 'fitness equipment exercise machines'),
  ]);
  const articles = [
    ...(training.status === 'fulfilled' ? training.value : []),
    ...(equipment.status === 'fulfilled' ? equipment.value : []),
  ];
  const unique = [...new Map(articles.map((article) => [article.id, article])).values()]
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!unique.length)
    return c.json({ error: { message: 'News is temporarily unavailable.' } }, 502);

  const response = c.json({ articles: unique, updatedAt: new Date().toISOString() });
  response.headers.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
  if (typeof caches !== 'undefined') {
    try {
      c.executionCtx.waitUntil(
        edgeCache().put(cacheKey, response.clone()).catch(() => undefined),
      );
    } catch {
      // Serving the successful response does not depend on cache writes.
    }
  }
  return response;
});
