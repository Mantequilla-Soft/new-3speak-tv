import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import {
  TAG_CATEGORIES, getCategoryOf, getTagLabel, getTagEmoji, isCategorySlug,
} from '../../utils/tagsV2';
import './TagsV2Picker.scss';

/**
 * Two-level topic-tree picker over the v2 taxonomy (7 CATEGORIES → 27 TOPICS).
 *
 * SINGLE mode (default, the vote/tag dialog): `value` is a single slug. Pick one
 * of the 7 broad CATEGORIES, then optionally refine to a TOPIC. Stopping at the
 * category is a valid, coarser tag.
 *
 * MULTI mode (the Interests picker): `value` is an ARRAY of topic slugs and
 * `onChange` receives the next array. Categories act as accordion headers with a
 * count badge; the selectable interests are the topics.
 *
 * `searchable` adds a filter box that flattens the tree to the matching topics
 * (and, in single mode, categories) so a topic can be found without navigating.
 */
function TagsV2Picker({
  value, onChange, tagPct = {}, disabled = false, suggested = [],
  multi = false, searchable = false,
}) {
  const { t } = useTranslation();
  const selectedArr = multi && Array.isArray(value) ? value : [];
  const selectedSet = useMemo(() => new Set(selectedArr), [selectedArr]);
  const isSel = (slug) => (multi ? selectedSet.has(slug) : value === slug);

  // Which category's topics are shown. Single mode derives it from the selected
  // value; multi mode tracks it locally (there's no single value), opening the
  // first category that already has a selection so returning users see it.
  const [openCatMulti, setOpenCatMulti] = useState(() => {
    if (!multi) return null;
    const cat = TAG_CATEGORIES.find((c) => c.topics.some((topic) => selectedSet.has(topic.slug)));
    return cat ? cat.slug : null;
  });
  const activeCategory = multi ? openCatMulti : getCategoryOf(value);
  const openCategory = TAG_CATEGORIES.find((c) => c.slug === activeCategory) || null;

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  // Search → flat list of matches. Both topics AND categories, in both modes: a
  // whole area is a selectable interest now, so it has to be findable by typing
  // its name and not only by browsing the tiles.
  const matches = useMemo(() => {
    if (!q) return null;
    const out = [];
    for (const cat of TAG_CATEGORIES) {
      // Categories are searchable in BOTH modes now. They used to be hidden from
      // multi-select results, which made a whole area findable by browsing but not
      // by typing its name — the one way most people look for it.
      const catLabel = t(cat.labelKey);
      if (catLabel.toLowerCase().includes(q)) {
        out.push({ slug: cat.slug, label: catLabel, emoji: cat.emoji, isCat: true });
      }
      for (const topic of cat.topics) {
        const topicLabel = t(topic.labelKey);
        if (topicLabel.toLowerCase().includes(q)) {
          out.push({ slug: topic.slug, label: topicLabel, emoji: topic.emoji, isCat: false });
        }
      }
    }
    return out;
  }, [q, multi, t]);

  const toggleMulti = (slug) => {
    onChange(selectedSet.has(slug) ? selectedArr.filter((s) => s !== slug) : [...selectedArr, slug]);
  };

  const pickCategory = (slug) => {
    if (disabled) return;
    if (multi) {
      // Clicking a whole area SELECTS it, which is what people expect from a tile
      // that looks like every other pickable chip. It used to only expand, so a
      // parent category was browsable but unpickable. It still expands too, so the
      // topics stay one click away if you want to narrow down instead.
      toggleMulti(slug);
      setOpenCatMulti((prev) => (prev === slug ? null : slug));
    } else {
      onChange(value === slug ? '' : slug);                              // select/clear
    }
  };

  const pickTopic = (slug) => {
    if (disabled) return;
    if (multi) toggleMulti(slug);
    else onChange(value === slug ? getCategoryOf(slug) : slug); // topic → back to category
  };

  const pickResult = (m) => {
    if (disabled) return;
    if (multi) toggleMulti(m.slug);
    else onChange(value === m.slug ? '' : m.slug);
  };

  const catCount = (cat) => cat.topics.reduce((n, topic) => n + (selectedSet.has(topic.slug) ? 1 : 0), 0);

  const known = suggested.filter(Boolean);

  const renderTopic = (topic) => {
    const pct = tagPct[topic.slug];
    return (
      <button
        type="button"
        key={topic.slug}
        className={`tagsv2-topic${isSel(topic.slug) ? ' selected' : ''}`}
        onClick={() => pickTopic(topic.slug)}
        disabled={disabled}
        aria-pressed={isSel(topic.slug)}
      >
        <span className="tagsv2-emoji">{topic.emoji}</span>
        <span className="tagsv2-label">{t(topic.labelKey)}</span>
        {pct != null && <span className="tagsv2-pct">{pct}%</span>}
      </button>
    );
  };

  return (
    <div className="tagsv2-picker" onClick={(e) => e.stopPropagation()}>
      {known.length > 0 && (
        <p className="tagsv2-suggested">
          {t('engagement.tagsPicker.autoTagged', { tags: known.map((s) => `${getTagEmoji(s)} ${getTagLabel(s)}`).join(', ') })}
        </p>
      )}

      {searchable && (
        <input
          type="search"
          className="tagsv2-search"
          placeholder={t('engagement.tagsPicker.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          aria-label={t('engagement.tagsPicker.searchAria')}
        />
      )}

      {q ? (
        matches.length === 0 ? (
          <p className="tagsv2-hint">{t('engagement.tagsPicker.noMatches', { query })}</p>
        ) : (
          <div className="tagsv2-row">
            {matches.map((m) => (
              <button
                type="button"
                key={m.slug}
                className={`${m.isCat ? 'tagsv2-cat' : 'tagsv2-topic'}${isSel(m.slug) ? ' selected' : ''}`}
                onClick={() => pickResult(m)}
                disabled={disabled}
                aria-pressed={isSel(m.slug)}
              >
                <span className="tagsv2-emoji">{m.emoji}</span>
                <span className="tagsv2-label">{m.label}</span>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="tagsv2-row">
            {TAG_CATEGORIES.map((cat) => {
              const isOpen = activeCategory === cat.slug;
              const pct = tagPct[cat.slug];
              const cnt = multi ? catCount(cat) : 0;
              return (
                <button
                  type="button"
                  key={cat.slug}
                  // `value === cat.slug` only ever worked in single mode: in multi,
                  // `value` is an ARRAY, so a selected category could never render
                  // as selected. isSel() handles both shapes.
                  className={`tagsv2-cat${isOpen ? ' open' : ''}${isSel(cat.slug) ? ' selected' : ''}${cnt > 0 ? ' has-selected' : ''}`}
                  onClick={() => pickCategory(cat.slug)}
                  disabled={disabled}
                  aria-pressed={isSel(cat.slug)}
                >
                  <span className="tagsv2-emoji">{cat.emoji}</span>
                  <span className="tagsv2-label">{t(cat.labelKey)}</span>
                  {cnt > 0 && <span className="tagsv2-count">{cnt}</span>}
                  {pct != null && <span className="tagsv2-pct">{pct}%</span>}
                </button>
              );
            })}
          </div>

          {openCategory && (
            <div className="tagsv2-topics">
              <p className="tagsv2-hint">
                {multi
                  ? (isSel(openCategory.slug)
                      ? t('engagement.tagsPicker.allSelected', { category: t(openCategory.labelKey) })
                      : t('engagement.tagsPicker.orPickTopics'))
                  : isCategorySlug(value)
                    ? t('engagement.tagsPicker.goodEnough')
                    : t('engagement.tagsPicker.moreSpecific')}
              </p>
              <div className="tagsv2-row">
                {openCategory.topics.map(renderTopic)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

TagsV2Picker.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.array]),
  onChange: PropTypes.func.isRequired,
  tagPct: PropTypes.object,
  disabled: PropTypes.bool,
  suggested: PropTypes.array,
  multi: PropTypes.bool,
  searchable: PropTypes.bool,
};

export default TagsV2Picker;
