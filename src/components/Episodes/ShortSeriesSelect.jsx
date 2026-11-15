import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMyPlaylists } from '../../hooks/useMyPlaylists';
import { isSeries, seriesParts } from '../../lib/series';
import { Field } from '../v2/ui';
import './Series.scss';

/**
 * While publishing a Short: the optional series it becomes the next part of
 * (lib/series.js). Lists the creator's own series; with none, says where one is
 * made (their channel's Series tab). `value` is the playlist id or ''.
 */
export default function ShortSeriesSelect({ value, onChange }) {
  const { t } = useTranslation();
  const id = useId();
  const { data: playlists = [], isLoading } = useMyPlaylists({ limit: 100 });
  const series = useMemo(() => playlists.filter(isSeries), [playlists]);
  if (isLoading) return null;
  if (!series.length) {
    return <p className="series-select__none">{t('episodes.series.noneYet')}</p>;
  }
  const chosen = series.find((s) => s.id === value);
  return (
    <Field
      id={id}
      label={t('episodes.series.selectLabel')}
      optional
      optionalLabel={t('episodes.numbers.optional')}
      hint={chosen ? t('episodes.series.selectHint', { part: seriesParts(chosen).length + 1 }) : null}
    >
      <select
        id={id}
        className="v2-input is-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="short-series-select"
      >
        <option value="">{t('episodes.series.noSeries')}</option>
        {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </Field>
  );
}
