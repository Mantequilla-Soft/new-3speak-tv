import { useMemo } from 'react';
import { parseEmbedUrl } from '../hive-api/hiveApi';
import { aiKey, isAiFlagged, useAiFlags } from '../utils/aiFlags';
import { useAppStore } from '../lib/store';

// The feed keys a short by owner + ASSET permlink, which is how the AI flag is
// stored, so that pair is a direct hit; the hive author is asked too in case the
// two accounts differ.
export const hiveAuthorOf = (s) => parseEmbedUrl(s.embed_url).author || s.owner;
export const isAiShort = (s) => isAiFlagged(s.owner, s.permlink) || isAiFlagged(hiveAuthorOf(s), s.permlink);

/**
 * The "Hide AI-generated" filter for an inline shorts POOL (home feed rails, the
 * watch page rails). Run it on the whole pool BEFORE slicing it into rows: a rail
 * is sized to exactly fill the width, so filtering a slice afterwards left an
 * empty slot per flagged short. Filtering the pool lets the next short move up.
 *
 * Unknown flags read as clean, so a short shows until the checker answers; when
 * an answer lands the pool re-filters and the rows reflow.
 */
export function useAiFilteredShorts(shorts) {
  const hideAi = useAppStore((st) => st.hideAi);
  const aiKeys = useMemo(
    () => (shorts || []).flatMap((s) => [aiKey(s.owner, s.permlink), aiKey(hiveAuthorOf(s), s.permlink)]),
    [shorts]
  );
  const aiVersion = useAiFlags(aiKeys);
  return useMemo(
    () => (hideAi ? (shorts || []).filter((s) => !isAiShort(s)) : shorts),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- aiVersion: isAiShort reads a module cache
    [shorts, hideAi, aiVersion]
  );
}
