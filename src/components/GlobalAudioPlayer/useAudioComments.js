import { useEffect, useState } from 'react';
import axios from 'axios';
import { getHiveUrl } from '../../utils/hiveNode';

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
 *
 * @returns {{ items: Array<{author, permlink, text, at: number|null}>, loading: boolean }}
 */
export default function useAudioComments(author, permlink, enabled = true, refresh = 0) {
  const key = author && permlink ? `${author}/${permlink}` : '';
  const [state, setState] = useState({ key: '', items: [], loading: false });

  useEffect(() => {
    if (!enabled || !key) return undefined;
    let live = true;
    setState((s) => (s.key === key ? { ...s, loading: true } : { key, items: [], loading: true }));
    axios.post(getHiveUrl(), {
      jsonrpc: '2.0', id: 1, method: 'condenser_api.get_content_replies', params: [author, permlink],
    }).then(({ data }) => {
      if (!live) return;
      const list = Array.isArray(data?.result) ? data.result : [];
      const items = list.map((c) => {
        let meta = {};
        try { meta = typeof c.json_metadata === 'string' ? JSON.parse(c.json_metadata || '{}') : (c.json_metadata || {}); } catch { meta = {}; }
        const at = typeof meta.parentTimestamp === 'number' && meta.parentTimestamp >= 0 ? meta.parentTimestamp : null;
        return { author: c.author, permlink: c.permlink, text: plain(c.body), at };
      }).filter((c) => c.author && c.text);
      setState({ key, items, loading: false });
    }).catch(() => { if (live) setState({ key, items: [], loading: false }); });
    return () => { live = false; };
  }, [key, author, permlink, enabled, refresh]);

  return state.key === key ? state : { items: [], loading: false };
}
