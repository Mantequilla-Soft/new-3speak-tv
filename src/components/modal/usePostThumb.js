import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { getHiveUrl } from '../../utils/hiveNode';

const mmss = (sec) => {
  const n = Math.round(Number(sec) || 0);
  if (n <= 0) return '';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * The thumbnail and length of a Hive post, for the context card at the top of
 * a sheet (SheetContext). The same read-only condenser_api.get_content call
 * useMyPlaylists makes for a playlist's first item; cached for ten minutes.
 * @returns {{ thumbnail?: string, duration?: string, title?: string }}
 */
export default function usePostThumb(author, permlink, enabled = true) {
  const { data } = useQuery({
    queryKey: ['postThumb', author, permlink],
    enabled: Boolean(enabled && author && permlink),
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await axios.post(getHiveUrl(), { jsonrpc: '2.0', method: 'condenser_api.get_content', params: [author, permlink], id: 1 });
      const raw = res.data?.result?.json_metadata;
      let meta = {};
      try { meta = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { meta = {}; }
      const ipfs = meta.video?.info?.ipfsThumbnail;
      return {
        thumbnail: meta.image?.[0] || (ipfs ? `https://ipfs.3speak.tv/ipfs/${ipfs}` : null),
        duration: mmss(meta.video?.info?.duration ?? meta.duration),
        title: res.data?.result?.title || '',
      };
    },
  });
  return data || {};
}
