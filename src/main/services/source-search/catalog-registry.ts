import { SOURCE_CATALOGS, getCatalog as getBaseCatalog } from './catalog-data';
import { communityCatalogEntry } from './community-catalog';
import { domainPatternsCatalog } from './domain-patterns';
import { opmlBundleCatalogs } from './opml-bundles';
import type { CatalogEntry } from './types';

export function listCatalogs(): CatalogEntry[] {
  const community = communityCatalogEntry();
  const extras = [domainPatternsCatalog(), ...opmlBundleCatalogs()];
  const withCommunity =
    community.items.length > 0 ? [...SOURCE_CATALOGS, community, ...extras] : [...SOURCE_CATALOGS, ...extras];
  return withCommunity.map((c) => ({
    ...c,
    items: c.items.map((i) => ({ ...i })),
  }));
}

export function getCatalog(id: string): CatalogEntry | undefined {
  if (id === 'community') return communityCatalogEntry();
  if (id === 'domain-patterns') return domainPatternsCatalog();
  const opml = opmlBundleCatalogs().find((c) => c.id === id);
  if (opml) return opml;
  return getBaseCatalog(id);
}

export { SOURCE_CATALOGS } from './catalog-data';
