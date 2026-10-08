import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import CardThumbnail from '../Cards/CardThumbnail';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { parseEmbedUrl, bodyToPlaintext } from '../../hive-api/hiveApi';
import { AiPill } from '../AiBadge/AiBadge';
import { aiKey, useAiFlags } from '../../utils/aiFlags';
import { hiveAuthorOf, isAiShort } from '../../hooks/useAiFilteredShorts';
import './ShortsRow.scss';

/**
 * ONE FULL ROW of shorts dropped INTO the video grid every few rows (see
 * HomeGrouped). It spans the full grid width (`.card-interleave` gets
 * `grid-column: 1 / -1`), so it reads as its own row between the video rows.
 *
 * Not a scroller: the caller measures how many shorts fit at the current width and
 * hands us exactly that many, plus the column count — so the row fills the width
 * edge-to-edge with no overflow and no second line.
 *
 * No heading and no "see all" — it should read as part of the feed, not as a
 * separate widget.
 */

/**
 * Shorts are posted as Hive COMMENTS, and comments have no title: `hive_title` is
 * empty for ~7 of 8, and `embed_title` is sometimes the literal string "Comment".
 * The real caption is the body — same source the shorts viewer uses — so run it
 * through bodyToPlaintext (strips the embed URL, markdown, HTML, tags) and take
 * the opening as the title.
 */
function shortTitle(s) {
  const caption = bodyToPlaintext(s.hive_body || '').trim();
  if (caption) return caption;

  const hive = (s.hive_title || '').trim();
  if (hive) return hive;

  const embed = (s.embed_title || '').trim();
  // "Comment" is the placeholder the uploader writes for a comment-type post —
  // never show it as a title.
  if (embed && embed.toLowerCase() !== 'comment') return embed;

  return '';
}

function ShortsRow({ shorts, columns }) {
  // "Hide AI-generated" is applied by the CALLER to the whole pool before slicing
  // (useAiFilteredShorts), so the row refills instead of leaving an empty slot.
  // Here we only subscribe so the AI pill appears once the flags land.
  const aiKeys = useMemo(
    () => (shorts || []).flatMap((s) => [aiKey(s.owner, s.permlink), aiKey(hiveAuthorOf(s), s.permlink)]),
    [shorts]
  );
  useAiFlags(aiKeys);

  if (!shorts?.length) return null;

  return (
    <div
      className="shorts-row"
      // The column count is computed from the live container width, so the row is
      // always exactly full. `minmax(0, 1fr)` (not just 1fr) lets the cards shrink
      // to the track instead of overflowing on a long title.
      style={{ gridTemplateColumns: `repeat(${columns || shorts.length}, minmax(0, 1fr))` }}
    >
      {shorts.map((s) => {
        // The feed keys a short by its ASSET permlink, but the shorts viewer is
        // addressed by the HIVE author from embed_url ("@author/permlink").
        const { author } = parseEmbedUrl(s.embed_url);
        const finalAuthor = author || s.owner;
        const title = shortTitle(s);

        return (
          <Link
            key={`${finalAuthor}/${s.permlink}`}
            to={`/shorts?v=${finalAuthor}/${s.permlink}`}
            className="shorts-row-card"
            title={title || `@${finalAuthor}`}
          >
            <div className="shorts-row-thumb">
              <CardThumbnail
                src={fixVideoThumbnail(s, true)}
                fallback={fallbackImg}
                alt={title}
              />
              {isAiShort(s) && <AiPill className="ai-badge--on-thumb" />}
            </div>
            <div className="shorts-row-meta">
              <h2>{title || `@${finalAuthor}`}</h2>
              <span className="shorts-row-author">@{finalAuthor}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

ShortsRow.propTypes = {
  shorts: PropTypes.array,
  columns: PropTypes.number,
};

export default ShortsRow;
