import { useTranslation } from 'react-i18next';

const KIND: Record<string, string> = {
  draft: 'draft',
  pending: 'pending',
  published: 'published',
};

export function StatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = KIND[status] ?? 'draft';
  const label =
    key === 'published'
      ? t('articles.statusPublished')
      : key === 'pending'
        ? t('articles.statusPending')
        : t('articles.statusDraft');

  return <span className={`ax-chip ax-chip--dot ax-chip--status-${key}`}>{label}</span>;
}
