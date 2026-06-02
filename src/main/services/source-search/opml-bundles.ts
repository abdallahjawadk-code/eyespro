import { parseOpml } from '../opml-import';
import type { CatalogEntry } from './types';

const BUNDLE_OPML: Array<{ id: string; name: string; description: string; language: string; xml: string }> = [
  {
    id: 'opml-gaming',
    name: 'ألعاب (OPML)',
    description: 'مدونات وأخبار ألعاب عالمية',
    language: 'en',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body>
  <outline text="Gaming" title="Gaming">
    <outline type="rss" text="Kotaku" title="Kotaku" xmlUrl="https://kotaku.com/rss" htmlUrl="https://kotaku.com"/>
    <outline type="rss" text="Polygon" title="Polygon" xmlUrl="https://www.polygon.com/rss/index.xml" htmlUrl="https://www.polygon.com"/>
    <outline type="rss" text="Eurogamer" title="Eurogamer" xmlUrl="https://www.eurogamer.net/feed" htmlUrl="https://www.eurogamer.net"/>
  </outline>
</body></opml>`,
  },
  {
    id: 'opml-science',
    name: 'علوم (OPML)',
    description: 'مدونات وعلوم شائعة',
    language: 'en',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body>
  <outline text="Science" title="Science">
    <outline type="rss" text="Phys.org" title="Phys.org" xmlUrl="https://phys.org/rss-feed/" htmlUrl="https://phys.org"/>
    <outline type="rss" text="Science News" title="Science News" xmlUrl="https://www.sciencenews.org/feed" htmlUrl="https://www.sciencenews.org"/>
    <outline type="rss" text="New Scientist" title="New Scientist" xmlUrl="https://www.newscientist.com/feed/home/" htmlUrl="https://www.newscientist.com"/>
  </outline>
</body></opml>`,
  },
  {
    id: 'opml-culture',
    name: 'ثقافة عالمية (OPML)',
    description: 'فنون وثقافة',
    language: 'en',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><body>
  <outline text="Culture" title="Culture">
    <outline type="rss" text="Open Culture" title="Open Culture" xmlUrl="https://www.openculture.com/feed" htmlUrl="https://www.openculture.com"/>
    <outline type="rss" text="Brain Pickings" title="The Marginalian" xmlUrl="https://www.themarginalian.org/feed/" htmlUrl="https://www.themarginalian.org"/>
  </outline>
</body></opml>`,
  },
];

function flattenOpml(xml: string, category: string): CatalogEntry['items'] {
  const outlines = parseOpml(xml);
  const items: CatalogEntry['items'] = [];
  function walk(nodes: typeof outlines, cat: string) {
    for (const o of nodes) {
      if (o.xmlUrl) {
        items.push({
          name: o.title || o.text,
          website: o.htmlUrl || o.xmlUrl,
          feedUrl: o.xmlUrl,
          type: 'rss',
          tags: [category, cat].filter(Boolean),
        });
      } else if (o.children?.length) {
        walk(o.children, o.text || cat);
      }
    }
  }
  walk(outlines, category);
  return items;
}

export function opmlBundleCatalogs(): CatalogEntry[] {
  return BUNDLE_OPML.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    language: b.language,
    items: flattenOpml(b.xml, b.id),
  }));
}
