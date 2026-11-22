/**
 * Which groups the Home activity panel's Groups tab lists, in order.
 *
 * Groups you joined that had videos this week come first, then every other
 * group by how busy it was this week, and joined groups that were quiet only
 * fill what is left. Before this, every joined group came first, so eight quiet
 * joined groups hid a busy one (Gaming Photography, 22 this week, 2026-11-22). Up to 16;
 * the panel shows only as many as fit (owner 2026-11-22).
 *
 * `activity`: the checker's { [hiveId]: { week, latest } }.
 * `joined`: a Set (or Map) of the hive-ids the viewer joined.
 */
export function rankGroups(activity, joined, limit = 16) {
  const week = (n) => Number(activity?.[n]?.week) || 0;
  const tier = (n) => (week(n) > 0 ? (joined.has(n) ? 0 : 1) : (joined.has(n) ? 2 : 3));
  return Object.keys(activity || {})
    .sort((a, b) => (tier(a) - tier(b)) || (week(b) - week(a)))
    .slice(0, limit);
}

/**
 * How many rows fit whole in a list `height` tall, from each row's bottom edge
 * measured from the top of the list. At least one, so the tab is never empty.
 */
export function fitCount(bottoms, height) {
  let n = 0;
  while (n < bottoms.length && bottoms[n] <= height + 0.5) n++;
  return Math.max(1, Math.min(n, bottoms.length));
}
