import { useEffect, useState } from 'react';
import { FaUserShield } from 'react-icons/fa';
import { fetchAdvertiserAdminView } from '../../lib/incubation';

const when = (d) => (d ? new Date(d).toLocaleString() : null);

/**
 * "Admin view" on an advertiser's warm-up page: everything about them in one place.
 * Their public brand profile (name, logo, bio, website, location, interests, counts)
 * from the page, and the private business contact nobody else can see (email,
 * address) from the admin-only route.
 *
 * Rendered for every visitor, shown to almost none: the server asks ButrAuth whether
 * the signed-in user may manage 3Speak's app (a platform admin or the app's owner)
 * and returns 404 to everyone else, so this renders nothing for them. Hiding it in
 * the page would not be enough; the data never reaches a non-admin browser.
 */
export default function AdvertiserAdminPanel({ handle, profile = {}, interests = [], counts = {} }) {
  const website = profile.website || null;
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchAdvertiserAdminView(handle).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [handle]);

  if (!data) return null;
  const c = data.contact;
  const a = c?.address || {};
  const addressLines = [
    a.line1, a.line2,
    [a.postalCode, a.city].filter(Boolean).join(' '),
    [a.region, a.country].filter(Boolean).join(', '),
  ].filter((l) => l && String(l).trim());

  return (
    <section className="inc-panel inc-admin" aria-label="Admin view">
      <h2><FaUserShield size={14} aria-hidden="true" /> Admin view</h2>
      <p className="inc-admin-note">Only 3Speak admins see this panel.</p>
      {/* Public on the left, private on the right; stacked on narrow screens. */}
      <div className="inc-admin-cols">
      <div>
      <h3 className="inc-admin-sub">Brand profile <span>public</span></h3>
      <dl>
        <div><dt>Handle</dt><dd>@{handle}</dd></div>
        <div><dt>Brand name</dt><dd>{profile.name || <em>not set</em>}</dd></div>
        <div>
          <dt>Logo</dt>
          <dd>{profile.profile_image
            ? <img className="inc-admin-logo" src={profile.profile_image} alt="" />
            : <em>not set</em>}</dd>
        </div>
        <div><dt>About</dt><dd className="inc-admin-about">{profile.about || <em>not set</em>}</dd></div>
        <div><dt>Website</dt><dd>{website ? <a href={website} target="_blank" rel="noopener noreferrer">{website}</a> : <em>none</em>}</dd></div>
        {profile.location ? <div><dt>Location</dt><dd>{profile.location}</dd></div> : null}
        {interests.length > 0 ? <div><dt>Interests</dt><dd>{interests.join(', ')}</dd></div> : null}
        <div><dt>Activity</dt><dd>{counts.posts ?? 0} posts · {counts.followers ?? 0} followers · {counts.following ?? 0} following</dd></div>
      </dl>
      </div>

      <div>
      <h3 className="inc-admin-sub">Private contact <span>admins only, never on chain</span></h3>
      {c ? (
        <dl>
          <div><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></div>
          <div>
            <dt>Address</dt>
            <dd>{addressLines.length ? addressLines.map((l) => <span key={l}>{l}</span>) : <em>not given</em>}</dd>
          </div>
          <div><dt>Contact goal</dt><dd>{c.email && (c.addressComplete || website) ? 'Met' : 'Not met yet'}</dd></div>
          <div><dt>First saved</dt><dd>{when(c.firstSavedAt) || <em>unknown</em>}</dd></div>
          <div><dt>Last changed</dt><dd>{when(c.updatedAt) || <em>unknown</em>}</dd></div>
          <div><dt>ButrAuth user</dt><dd><code>{c.butrauthUserId}</code></dd></div>
        </dl>
      ) : (
        <p className="inc-admin-empty">No business contact saved yet.</p>
      )}
      </div>
      </div>
    </section>
  );
}
