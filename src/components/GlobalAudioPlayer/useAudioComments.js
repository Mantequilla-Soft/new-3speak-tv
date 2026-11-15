import { useEffect, useState } from 'react';
import axios from 'axios';
import { getHiveUrl } from '../../utils/hiveNode';
import { batchCheckFlags } from '../../utils/hiddenCreators';
import { useAppStore } from '../../lib/store';

// Plain text for a one-line preview: no markdown images, links as their text,
// no HTML tags, collapsed whitespace. Rendered as text, never as HTML.
function plain(body) {
  return String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_>`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The replies to the Hive post of the audio playing, for the player's Comments
 * panel and the pins on its waveform. Read only, once per post while `enabled`.
 * A reply posted from the player at a moment carries that moment in its
 * json_metadata (`parentTimestamp`, AudioCommentPanel), the way the watch page does.
 * Replies by bots on the global comment mutelist are left out (never the viewer's
 * own); the mutelist lookup fails open.
 *
 * @returns {{ items: Array<{author, permlink, text, at: number|null}>, loading: boolean }}
 */
export default function useAudioComments(author, permlink, enabled = true, refresh = 0) {
  const key = author && permlink ? `${author}/${permlink}` : '';
  // The answer for `key` (and the refresh it answered); until it is in, loading.
  const [state, setState] = useState({ key: '', refresh: -1, items: [] });

  useEffect(() => {
    if (!enabled || !key) return undefined;
    let live = true;
    axios.post(getHiveUrl(), {
      jsonrpc: '2.0', id: 1, method: 'condenser_api.get_content_replies', params: [author, permlink],
    }).then(async ({ data }) => {
      if (!live) return;
      const list = Array.isArray(data?.result) ? data.result : [];
      const { muted } = await batchCheckFlags(list.map((c) => c?.author));
      if (!live) return;
      const me = String(useAppStore.getState().user || '').toLowerCase();
      const items = list.filter((c) => {
        const name = String(c?.author || '').toLowerCase();
        return !(muted.has(name) && name !== me);
      }).map((c) => {
        let meta;
        try { meta = typeof c.json_metadata === 'string' ? JSON.parse(c.json_metadata || '{}') : (c.json_metadata || {}); } catch { meta = {}; }
        const at = typeof meta.parentTimestamp === 'number' && meta.parentTimestamp >= 0 ? meta.parentTimestamp : null;
        return { author: c.author, permlink: c.permlink, text: plain(c.body), at };
      }).filter((c) => c.author && c.text);
      setState({ key, refresh, items });
    }).catch(() => { if (live) setState({ key, refresh, items: [] }); });
    return () => { live = false; };
  }, [key, author, permlink, enabled, refresh]);

  if (state.key !== key) return { items: [], loading: enabled && !!key };
  // A refresh keeps the list it had while the new one loads.
  return { items: state.items, loading: enabled && state.refresh !== refresh };
}
