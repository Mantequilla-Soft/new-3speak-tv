import React from 'react';
import { useTranslation } from 'react-i18next';
import { THUMBNAIL_TOOLS, toolIsEnabled } from './tools';

/** The tool tabs and the open tool's panel (the editor popup's side column). */
export default function ThumbnailTools({ activeTool, onToolChange, ...panelProps }) {
  const { t } = useTranslation();
  const tools = THUMBNAIL_TOOLS.filter((x) => !x.available || x.available(panelProps));
  const tool = tools.find((x) => x.key === activeTool) || tools[0];
  const { Panel } = tool;

  return (
    <section className="thumb-tools">
      <div className="v2-seg is-block is-scroll thumb-tools__tabs" role="tablist">
        {tools.map((x) => {
          const { key, icon: Icon, labelKey } = x;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`thumb-tab-${key}`}
              aria-selected={key === tool.key}
              aria-controls="thumb-tool-panel"
              className={`v2-seg__opt h36 thumb-tools__tab${key === tool.key ? ' is-on is-active' : ''}`}
              onClick={() => onToolChange(key)}
              disabled={!toolIsEnabled(x, panelProps)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
      <div className="thumb-tools__panel" id="thumb-tool-panel" role="tabpanel" aria-labelledby={`thumb-tab-${tool.key}`}>
        {toolIsEnabled(tool, panelProps) ? <Panel {...panelProps} onToolChange={onToolChange} /> : null}
      </div>
    </section>
  );
}
