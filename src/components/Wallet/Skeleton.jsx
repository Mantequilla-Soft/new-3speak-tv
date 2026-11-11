import React from 'react';
import './Skeleton.scss';

// Placeholder rows shaped like the wallet activity rows (TrxHistory).
const Skeleton = ({ rows = 5 }) => {
  return (
    <div className="skeleton-loader" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton-row">
          <div className="v2-skeleton skeleton-icon"></div>
          <div className="skeleton-lines">
            <div className="v2-skeleton is-line skeleton-title"></div>
            <div className="v2-skeleton is-line skeleton-sub"></div>
          </div>
          <div className="v2-skeleton is-line skeleton-amount"></div>
        </div>
      ))}
    </div>
  );
};

export default Skeleton;
