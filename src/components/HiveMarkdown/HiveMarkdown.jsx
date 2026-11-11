import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { getPostBodyRenderer } from '../../lib/hiveRenderer';
import './HiveMarkdown.scss';

/**
 * Renders a Hive markdown/HTML string (post body, community description, …) to
 * sanitized HTML via lib/hiveRenderer. Reusable wherever Hive-flavoured
 * markdown needs to be displayed outside the main post body.
 *
 * When `collapsible` is set, long content is clipped to `collapsedHeight` with a
 * "Show more / Show less" toggle, the same UX as the video description.
 */
export default function HiveMarkdown({ body, className = '', collapsible = false, collapsedHeight = 140 }) {
  const { t } = useTranslation();
  const [html, setHtml] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    if (!body) {
      setHtml('');
      return;
    }
    let cancelled = false;
    getPostBodyRenderer()
      .then((render) => {
        if (cancelled) return;
        try {
          setHtml(render(body));
        } catch {
          setHtml('');
        }
      })
      .catch(() => {
        if (!cancelled) setHtml('');
      });
    return () => {
      cancelled = true;
    };
  }, [body]);

  // Decide whether the content is tall enough to warrant collapsing.
  useEffect(() => {
    if (!collapsible || !html || !contentRef.current) return;
    const id = requestAnimationFrame(() => {
      const h = contentRef.current?.scrollHeight || 0;
      setNeedsCollapse(h > collapsedHeight + 24);
    });
    return () => cancelAnimationFrame(id);
  }, [collapsible, html, collapsedHeight]);

  if (!html) return null;

  const collapsed = collapsible && needsCollapse && !expanded;

  return (
    <div className={`hive-markdown-block ${className}`.trim()}>
      <div className="hive-markdown-clip">
        <div
          ref={contentRef}
          className={`hive-markdown markdown-view${collapsed ? ' is-collapsed' : ''}`}
          style={collapsed ? { maxHeight: collapsedHeight } : undefined}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {collapsible && needsCollapse && (
        <button
          type="button"
          className="hive-markdown-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          <span>{expanded ? t('common.actions.showLess') : t('common.actions.showMore')}</span>
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={18} />
        </button>
      )}
    </div>
  );
}
