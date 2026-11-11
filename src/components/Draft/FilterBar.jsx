import "./FilterBar.scss";
import { useTranslation } from 'react-i18next';
import { Segmented } from '../v2/ui';

// Studio filter: a segmented track (STYLE_GUIDE §6, tabs are never underlined).
// filter values: 'all' | 'published' | 'scheduled' | 'publish_manual' (failed)
// counts: optional { [value]: number } shown next to the label.
const FilterBar = ({ onFilterChange, activeFilter, counts = {} }) => {
  const { t } = useTranslation();
  const filters = [
    { value: 'all', label: t('upload.drafts.filters.all') },
    { value: 'published', label: t('upload.drafts.filters.published') },
    { value: 'scheduled', label: t('upload.drafts.status.scheduled') },
    { value: 'publish_manual', label: t('upload.drafts.filters.failed') },
  ].map((f) => (counts[f.value] != null ? { ...f, count: counts[f.value] } : f));

  return (
    <div className="studio-filter">
      <Segmented
        options={filters}
        value={activeFilter}
        onChange={onFilterChange}
        block={false}
        scroll
        size={36}
        label={t('studio.drafts.title')}
      />
    </div>
  );
};

export default FilterBar;
