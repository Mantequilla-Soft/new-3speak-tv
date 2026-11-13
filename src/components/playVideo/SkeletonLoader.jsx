import React from 'react'
import "./SkeletonLoader.scss"

function SkeletonLoader() {
  return (
    <div className="skeleton-loader">
      <div className="skeleton-video"></div>
      
      <div className="skeleton-title"></div>
      
      <div className="skeleton-tags">
        <div className="skeleton-tag"></div>
        <div className="skeleton-tag"></div>
        <div className="skeleton-tag"></div>
      </div>
      
      <div className="skeleton-community"></div>
      
      <div className="skeleton-stats">
        <div></div>
        <div></div>
        <div></div>
      </div>
      
      <div className="skeleton-publisher">
        <div className="skeleton-publisher-avatar"></div>
        <div className="skeleton-publisher-info">
          <div></div>
          <div></div>
        </div>
        <div className="skeleton-publisher-button"></div>
      </div>
      
      <div className="skeleton-description"></div>
      <div className="skeleton-comment"></div>
    </div>
  )
}

export default SkeletonLoader