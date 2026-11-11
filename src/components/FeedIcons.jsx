import { Icon } from "./v2/Icon";

// Feed page header icons, now Material Symbols (49c: a cyan icon well before the
// title). Kept as components so every feed page imports them the same way.
export const TrendingIcon = () => <Icon name="local_fire_department" size={24} />;
export const NewContentIcon = () => <Icon name="schedule" size={24} />;
export const FirstUploadIcon = () => <Icon name="spa" size={24} />;
export const FollowFeedIcon = () => <Icon name="subscriptions" size={24} />;

// The header every feed page opens with: icon well + page title (49c).
export function FeedPageHeader({ icon, title, children }) {
  return (
    <div className="feed-page-header">
      <span className="feed-page-header__icon" aria-hidden="true">{icon}</span>
      <h1>{title}</h1>
      {children}
    </div>
  );
}
