import { useAppStore } from '../lib/store';

/**
 * Shared feed query params for every checker-backed discovery feed, so they all
 * behave the same way:
 *   - `interests=`   — the user's selected interests (re-ranks matching videos up)
 *   - `currentuser=` — sent whenever we know who is asking. The server uses it for
 *                      BOTH the explicit dismissals ("not interested" / hidden
 *                      creator, always applied) and hide-watched.
 *   - `hidewatched=` — the actual "Hide watched" preference.
 *
 * `currentuser` used to be sent only when "Hide watched" was on, which the server
 * took as "hide watched videos". Now that dismissals need `currentuser` too, we
 * always send it and pass the preference explicitly. The server defaults
 * `hidewatched` to TRUE when absent, so the deployed prod frontend (which still
 * only sends currentuser when the setting is on) keeps behaving exactly as before.
 *
 * Returns a string like "&interests=a,b&currentuser=bob&hidewatched=1" (leading
 * `&`), or "" when nothing applies — safe to append straight onto a feed URL.
 *
 * NOT used on the "new videos" feed, which must stay purely chronological.
 */
export function feedParams() {
  const st = useAppStore.getState();
  let p = '';
  const list = st.interests;
  if (Array.isArray(list) && list.length) p += `&interests=${encodeURIComponent(list.join(','))}`;
  if (st.user) {
    p += `&currentuser=${encodeURIComponent(st.user)}`;
    p += `&hidewatched=${st.hideWatched ? '1' : '0'}`;
  }
  return p;
}
