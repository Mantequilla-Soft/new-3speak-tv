/**
 * On a Short made from a longer post (lib/derived.js `madeFrom`): the post it
 * came from, as the same pill the audiogram episode card uses. A teaser or a
 * clip opens the full video (a clip at its moment), a stream clip or recap the
 * stream's recording. A teaser of a premiere that has not started counts down
 * to it ("Premieres in 2 h 5 min"), from the checker's premiere record.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { getPostDetails } from '../../hive-api/hiveApi';
import { fetchPremiere, premiereState } from '../../lib/premieres';
import { watchPath } from '../../utils/urls';
import '../AudiogramEpisodeLink/AudiogramEpisodeLink.scss';

/** The kinds that get the card (an audiogram has its own, a remix says so in its text). */
export const SOURCE_LINK_KINDS = new Set(['teaser', 'clip', 'stream_clip', 'recap']);

const metaOf = (post) => {
  try {
    return typeof post?.json_metadata === 'string' ? JSON.parse(post.json_metadata || '{}') : (post?.json_metadata || {});
  } catch {
    return {};
  }
};

/** Minutes until `startMs`, for the countdown text; never below one. */
export function untilParts(startMs, nowMs) {
  const mins = Math.max(1, Math.ceil((startMs - nowMs) / 60000));
  return { h: Math.floor(mins / 60), m: mins % 60 };
}

export default function SourceLink({ source, className = '' }) {
  const { t } = useTranslation();
  const { author, permlink, kind, start } = source || {};
  const { data } = useQuery({
    queryKey: ['derived-source', author, permlink],
    queryFn: async () => {
      const post = await getPostDetails(author, permlink).catch(() => null);
      const jm = metaOf(post);
      const cover = [jm.image?.[0], jm.video?.thumbnail].find((u) => typeof u === 'string' && /^https:\/\//.test(u)) || null;
      return { title: post?.title || jm.video?.info?.title || '', cover };
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!(author && permlink),
  });
  const { data: premiere } = useQuery({
    queryKey: ['derived-source-premiere', author, permlink],
    queryFn: async () => (await fetchPremiere(author, permlink).catch(() => ({ premiere: null }))).premiere,
    staleTime: 60 * 1000,
    enabled: kind === 'teaser' && !!(author && permlink),
  });
  const [now, setNow] = useState(() => Date.now());
  const soon = premiere && premiereState(premiere, now) === 'soon';
  useEffect(() => {
    if (!soon) return undefined;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [soon]);

  if (!author || !permlink || !SOURCE_LINK_KINDS.has(kind)) return null;

  let label = kind === 'stream_clip' || kind === 'recap' ? t('derived.link.fullStream') : t('derived.link.fullVideo');
  if (soon) {
    const { h, m } = untilParts(Date.parse(premiere.startAt), now);
    label = t('derived.link.premieresIn', { time: h ? t('derived.link.hm', { h, m }) : t('derived.link.m', { m }) });
  }
  const at = kind !== 'teaser' && Number.isFinite(start) && start > 0 ? `t=${Math.floor(start)}` : '';
  const title = data?.title || `@${author}`;

  return (
    <Link
      to={watchPath(author, permlink, at)}
      className={`audiogramEpisodeLink sourceLink ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
      aria-label={t('derived.link.open', { label, title })}
      data-testid="source-link"
    >
      <span className="audiogramEpisodeLink__cover" aria-hidden="true">
        {data?.cover ? <img src={data.cover} alt="" loading="lazy" /> : <Icon name={soon ? 'schedule' : 'smart_display'} size={16} />}
      </span>
      <span className="audiogramEpisodeLink__text">
        <small>{label}</small>
        <span aria-hidden="true"> · </span>
        <strong>{title}</strong>
      </span>
    </Link>
  );
}
