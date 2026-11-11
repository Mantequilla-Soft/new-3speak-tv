// Helpers shared by the top bar's search (NavSearch), its dropdown
// (SearchSuggest) and the search page (Discover).
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFollowers } from '../../hive-api/api';

/** Where a search runs: the search page (design 21a), linkable by its `q`. */
export const searchPagePath = (term) => `/discover?q=${encodeURIComponent(term)}`;

/** A creator's follower count from Hive (null until known). */
export function useFollowerCount(name) {
  return useQuery({
    queryKey: ['follow-count', name],
    queryFn: async () => (await getFollowers(name))?.follower_count ?? null,
    enabled: !!name,
    staleTime: 10 * 60 * 1000,
  }).data;
}

// Recent searches (design 28c "Recent" chips): the last few terms this viewer
// searched for, kept in this browser only. A per-viewer convenience, so every
// read and write is guarded: private mode or blocked storage just means no list.

const KEY = '3speak_recent_searches';
const MAX = 6;
const EVENT = '3speak:recent-searches';

export function readRecentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.trim()).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage off */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

/** Put a term at the front of the list (deduped, case-insensitive). */
export function addRecentSearch(term) {
  const clean = String(term || '').trim();
  if (clean.length < 2) return;
  const rest = readRecentSearches().filter((s) => s.toLowerCase() !== clean.toLowerCase());
  write([clean, ...rest]);
}

export function removeRecentSearch(term) {
  write(readRecentSearches().filter((s) => s !== term));
}

/** The list, kept in step across every search box on the page. */
export function useRecentSearches() {
  const [list, setList] = useState(readRecentSearches);
  useEffect(() => {
    const sync = () => setList(readRecentSearches());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const remove = useCallback((term) => removeRecentSearch(term), []);
  return [list, remove];
}
