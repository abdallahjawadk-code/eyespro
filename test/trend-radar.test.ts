import { describe, it, expect } from 'vitest';
import { parseGoogleTrendsRss } from '../src/main/services/trend-parser';

describe('trend-radar parser', () => {
  it('parses correct item tags from XML content', () => {
    const mockXml = `
      <rss version="2.0" xmlns:ht="https://trends.google.com/">
        <channel>
          <title>Daily Search Trends</title>
          <item>
            <title>روبوت الدردشة الجديد</title>
            <ht:approx_traffic>100K+</ht:approx_traffic>
            <description>تحديث كبير قادم لروبوت الدردشة الشهير.</description>
            <ht:news_item>
              <ht:news_item_title>غوغل تطلق ميزات جديدة</ht:news_item_title>
              <ht:news_item_url>https://example.com/news1</ht:news_item_url>
            </ht:news_item>
          </item>
          <item>
            <title>Elon Musk</title>
            <ht:approx_traffic>50K+</ht:approx_traffic>
            <description></description>
          </item>
        </channel>
      </rss>
    `;

    const result = parseGoogleTrendsRss(mockXml);

    expect(result.length).toBe(2);
    expect(result[0].title).toBe('روبوت الدردشة الجديد');
    expect(result[0].traffic).toBe('100K+');
    expect(result[0].description).toContain('تحديث كبير قادم');
    expect(result[0].description).toContain('غوغل تطلق ميزات جديدة');
    expect(result[1].title).toBe('Elon Musk');
    expect(result[1].traffic).toBe('50K+');
    expect(result[1].description).toBeNull();
  });

  it('skips item without title', () => {
    const mockXml = `
      <rss version="2.0">
        <channel>
          <item>
            <ht:approx_traffic>10K+</ht:approx_traffic>
          </item>
        </channel>
      </rss>
    `;
    const result = parseGoogleTrendsRss(mockXml);
    expect(result.length).toBe(0);
  });
});
