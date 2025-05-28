import React, { useState } from 'react';
import "./FilterBar.scss"

// type FilterOption = 'all' | 'published' | 'failed';

// interface FilterBarProps {
//   onFilterChange: (filter: FilterOption) => void;
//   activeFilter: FilterOption;
// }

const FilterBar = ({ onFilterChange, activeFilter }) => {
  const filters = [
    { value: 'all', label: 'All Videos' },
    { value: 'published', label: 'Published' },
    { value: 'publish_manual', label: 'Failed' }
  ];

  return (
    <div className="filter">
      <div className="filter__content">
        <h2 className="filter__title"> Videos Draft</h2>
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