import React, { useState } from 'react';
import "./FilterBar.scss"
import { useTranslation } from 'react-i18next';

// type FilterOption = 'all' | 'published' | 'failed';

// interface FilterBarProps {
//   onFilterChange: (filter: FilterOption) => void;
//   activeFilter: FilterOption;
// }

const FilterBar = ({ onFilterChange, activeFilter }) => {
  const { t } = useTranslation();
  const filters = [
    { value: 'all', label: t('upload.drafts.filters.all') },
    { value: 'published', label: t('upload.drafts.filters.published') },
    {value: "scheduled", label: t('upload.drafts.filters.scheduled')},
    { value: 'publish_manual', label: t('upload.drafts.filters.failed') }
  ];

  return (
    <div className="filter">
      <div className="filter__content">
        <h2 className="filter__title">{t('upload.drafts.title')}</h2>
        <div className="filter__options">
          {filters.map(filter => (
            <button
              key={filter.value}
              className={`filter__option ${activeFilter === filter.value ? 'filter__option--active' : ''}`}
              onClick={() => onFilterChange(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FilterBar;