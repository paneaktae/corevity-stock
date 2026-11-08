import { useMemo, useState } from 'react';
import { ExternalLink, Newspaper, RefreshCw } from 'lucide-react';
import { ErrorBox, Header, Loading } from '../components/ui';
import { useData } from '../lib';
import { localized, useLanguage } from '../i18n';
import type { NewsArticle } from '../../worker/news';

type NewsResponse = { articles: NewsArticle[]; updatedAt: string };
type Filter = 'all' | NewsArticle['topic'];

export function NewsPage() {
  const language = useLanguage();
  const [refreshToken, setRefreshToken] = useState(0);
  const requestPath = refreshToken ? `/news?refresh=1&nonce=${refreshToken}` : '/news';
  const { data, error } = useData<NewsResponse>(requestPath);
  const [filter, setFilter] = useState<Filter>('all');
  const articles = useMemo(
    () => (data?.articles ?? []).filter((article) => filter === 'all' || article.topic === filter),
    [data?.articles, filter],
  );
  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: localized('All stories', 'ทั้งหมด') },
    { value: 'training', label: localized('Workout trends', 'เทรนด์การออกกำลังกาย') },
    { value: 'equipment', label: localized('Exercise equipment', 'เครื่องออกกำลังกาย') },
  ];
  const formattedDate = (value: string) => {
    if (!value) return localized('Date unavailable', 'ไม่ระบุวันที่');
    return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
      dateStyle: 'medium',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(`${value}T12:00:00Z`));
  };

  return (
    <>
      <Header
        eyebrow={localized('Knowledge & updates', 'ความรู้และข่าวสาร')}
        title={localized('Fitness & equipment news', 'ข่าวสารเทรนด์ฟิตเนสและเครื่องออกกำลังกาย')}
        subtitle={localized(
          'Recent research and updates on workout trends and exercise equipment.',
          'รวมบทความและงานวิจัยล่าสุดเกี่ยวกับเทรนด์การออกกำลังกายและเครื่องออกกำลังกาย',
        )}
        action={
          <button className="button" type="button" onClick={() => setRefreshToken((token) => token + 1)} aria-label={localized('Refresh news', 'โหลดข่าวใหม่')}>
            <RefreshCw size={16} />
            {localized('Refresh', 'โหลดใหม่')}
          </button>
        }
      />

      <section className="news-page" aria-label={localized('Fitness news', 'ข่าวสารฟิตเนส')}>
        <div className="news-toolbar">
          <div className="news-filters" role="group" aria-label={localized('Filter news', 'กรองข่าวสาร')}>
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`news-filter${filter === item.value ? ' active' : ''}`}
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {data?.updatedAt && (
            <span className="news-updated">
              {localized('Updated', 'อัปเดต')} {new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(data.updatedAt))}
            </span>
          )}
        </div>

        {error && <ErrorBox message={error} />}
        {!data && !error && <Loading />}
        {data && articles.length > 0 && (
          <div className="news-grid">
            {articles.map((article) => (
              <article className="news-card" key={article.id}>
                <div className="news-card-topline">
                  <span className={`news-topic ${article.topic}`}>
                    {article.topic === 'training' ? filters[1].label : filters[2].label}
                  </span>
                  <time dateTime={article.date || undefined}>{formattedDate(article.date)}</time>
                </div>
                <h2>{article.title}</h2>
                <div className="news-card-footer">
                  <div className="news-publication">
                    <Newspaper size={15} aria-hidden="true" />
                    <span>{article.publication || article.publisher}</span>
                  </div>
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    {localized('Read source', 'อ่านจากแหล่งต้นทาง')}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
        {data && articles.length === 0 && (
          <div className="news-empty">
            <Newspaper size={24} />
            <p>{localized('No articles found in this category.', 'ยังไม่มีบทความในหมวดนี้')}</p>
          </div>
        )}
        <p className="news-attribution">
          {localized(
            'Titles, publication details and links are provided by Crossref. Open a source to read the full article.',
            'ชื่อบทความ ข้อมูลแหล่งเผยแพร่ และลิงก์มาจาก Crossref กดแหล่งต้นทางเพื่ออ่านบทความฉบับเต็ม',
          )}
        </p>
      </section>
    </>
  );
}
