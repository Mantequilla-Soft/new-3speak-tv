import React, { useEffect, useState } from 'react'

import "./ToolTip.scss"

function ToolTip({tooltipVoters}) {
  return (
    <div className="tooltip" id="reward-tooltip">
                {/* {data.length > 0 ? ( */}
                    {tooltipVoters.map((voter, index) => (
                        <div key={index} className="tooltip-item">
                            <span className="username">@{voter.username}</span>
                            <span className="reward">: ${voter.reward.toFixed(2)}</span>
                        </div>
                    ))}
                {/* ) : (
                    <p>No upvotes yet.</p>
                )} */}
                <div className="arrow"></div>
            </div>
  )
}

export default ToolTip