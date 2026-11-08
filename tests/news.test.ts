import { describe, expect, it } from 'vitest';
import { mapCrossrefWorks } from '../worker/news';

describe('fitness news metadata', () => {
  it('maps source metadata into safe article cards', () => {
    const articles = mapCrossrefWorks(
      [
        {
          DOI: '10.1234/example',
          title: ['  Exercise   training advances '],
          publisher: 'Example Publisher',
          URL: 'https://doi.org/10.1234/example',
          'container-title': ['Fitness Research'],
          published: { 'date-parts': [[2026, 3, 9]] },
        },
      ],
      'training',
    );
    expect(articles).toEqual([
      {
        id: '10.1234/example',
        title: 'Exercise training advances',
        publisher: 'Example Publisher',
        publication: 'Fitness Research',
        date: '2026-03-09',
        url: 'https://doi.org/10.1234/example',
        topic: 'training',
      },
    ]);
  });

  it('ignores missing titles and non-HTTPS links', () => {
    expect(
      mapCrossrefWorks(
        [
          { title: ['Missing URL'] },
          { title: ['Unsafe URL'], URL: 'javascript:alert(1)' },
          { URL: 'https://doi.org/10.1234/no-title' },
        ],
        'equipment',
      ),
    ).toEqual([]);
  });
});
