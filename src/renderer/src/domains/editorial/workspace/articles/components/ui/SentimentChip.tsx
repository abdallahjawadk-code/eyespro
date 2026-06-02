import { useTranslation } from 'react-i18next';

export function SentimentChip({ sentiment }: { sentiment: string | null | undefined }) {
  const { t } = useTranslation();
  if (!sentiment) return <span className="ax-muted">—</span>;

  const s = sentiment.toLowerCase();
  const kind = s.includes('pos') ? 'pos' : s.includes('neg') ? 'neg' : 'neu';
  const label =
    kind === 'pos'
      ? t('articles.sentiment_positive')
      : kind === 'neg'
        ? t('articles.sentiment_negative')
        : t('articles.sentiment_neutral');

  return <span className={`ax-chip ax-chip--sentiment-${kind}`}>{label}</span>;
}
