import { useEffect, useState } from 'react';
import { FaUserShield } from 'react-icons/fa';
import { fetchAdvertiserAdminView } from '../../lib/incubation';
import { getLinks, platformProfileUrl, platformLabel } from '../../utils/socialVerifier';
import { PLATFORM_ICONS } from '../Userprofilepage/SocialLinks';
import { useTranslation } from 'react-i18next';

const when = (d) => (d ? new Date(d).toLocaleString() : null);

/**
 * "Admin view" on an advertiser's warm-up page: everything about them in one place.
 * Their public brand profile (name, logo, bio, website, location, interests, counts)
 * from the page, the social profiles they linked through the checker's verifier
 * (verified ones as links, unverified ones marked, since an admin wants to see
 * those too), and the private business contact nobody else can see (email,
 * address) from the admin-only route.
 *
 * Rendered for every visitor, shown to almost none: the server asks ButrAuth whether
 * the signed-in user may manage 3Speak's app (a platform admin or the app's owner)
 * and returns 404 to everyone else, so this renders nothing for them. Hiding it in
 * the page would not be enough; the data never reaches a non-admin browser.
 */
export default function AdvertiserAdminPanel({ handle, profile = {}, interests = [], counts = {} }) {
  const { t } = useTranslation();
  const website = profile.website || null;
  const [data, setData] = useState(null);

  const [socials, setSocials] = useState([]);

  useEffect(() => {
    let alive = true;
    fetchAdvertiserAdminView(handle).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [handle]);

  // Public data, but only fetched once the admin route has answered: nobody
  // else renders this panel, so nobody else should pay for the request.
  useEffect(() => {
    if (!data || !handle) return undefined;
    let alive = true;
    getLinks(handle, { includePending: true })
      .then((links) => { if (alive) setSocials(Array.isArray(links) ? links : []); })
      .catch(() => { if (alive) setSocials([]); });
    return () => { alive = false; };
  }, [data, handle]);

  if (!data) return null;
  const c = data.contact;
  const a = c?.address || {};
  const addressLines = [
    a.line1, a.line2,
    [a.postalCode, a.city].filter(Boolean).join(' '),
    [a.region, a.country].filter(Boolean).join(', '),
  ].filter((l) => l && String(l).trim());

  return (
    <section className="inc-panel inc-admin" aria-label={t('incubation.admin.title')}>
      <h2><FaUserShield size={14} aria-hidden="true" /> {t('incubation.admin.title')}</h2>
      <p className="inc-admin-note">{t('incubation.admin.note')}</p>
      {/* Public on the left, private on the right; stacked on narrow screens. */}
      <div className="inc-admin-cols">
      <div>
      <h3 className="inc-admin-sub">{t('incubation.admin.brandProfile')} <span>{t('incubation.admin.public')}</span></h3>
      <dl>
        <div><dt>{t('incubation.admin.fields.handle')}</dt><dd>@{handle}</dd></div>
        <div><dt>{t('incubation.admin.fields.brandName')}</dt><dd>{profile.name || <em>{t('incubation.admin.notSet')}</em>}</dd></div>
        <div>
          <dt>{t('incubation.admin.fields.logo')}</dt>
          <dd>{profile.profile_image
            ? <img className="inc-admin-logo" src={profile.profile_image} alt="" />
            : <em>{t('incubation.admin.notSet')}</em>}</dd>
        </div>
        <div><dt>{t('incubation.admin.fields.about')}</dt><dd className="inc-admin-about">{profile.about || <em>{t('incubation.admin.notSet')}</em>}</dd></div>
        <div><dt>{t('incubation.admin.fields.website')}</dt><dd>{website ? <a href={website} target="_blank" rel="noopener noreferrer">{website}</a> : <em>{t('incubation.admin.none')}</em>}</dd></div>
        {socials.length > 0 ? (
          <div>
            <dt>{t('incubation.admin.fields.socials')}</dt>
            <dd className="inc-admin-socials">
              {socials.map((link) => {
                const Icon = PLATFORM_ICONS[link.platform];
                const url = platformProfileUrl(link.platform, link.platform_username);
                const label = `${platformLabel(link.platform)}: ${link.platform_username}`;
                return (
                  <span key={`${link.platform}:${link.platform_username}`} className="inc-admin-social">
                    {Icon ? <Icon size={13} aria-hidden="true" /> : null}
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a> : label}
                    {!link.verified ? <em> ({t('incubation.admin.notVerified')})</em> : null}
                  </span>
                );
              })}
            </dd>
          </div>
        ) : null}
        {profile.location ? <div><dt>{t('incubation.admin.fields.location')}</dt><dd>{profile.location}</dd></div> : null}
        {interests.length > 0 ? <div><dt>{t('incubation.admin.fields.interests')}</dt><dd>{interests.join(', ')}</dd></div> : null}
        <div><dt>{t('incubation.admin.fields.activity')}</dt><dd>{t('incubation.admin.activityLine', { posts: counts.posts ?? 0, followers: counts.followers ?? 0, following: counts.following ?? 0 })}</dd></div>
      </dl>
      </div>

      <div>
      <h3 className="inc-admin-sub">{t('incubation.admin.privateContact')} <span>{t('incubation.admin.privateNote')}</span></h3>
      {c ? (
        <dl>
          <div><dt>{t('incubation.admin.fields.email')}</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></div>
          <div>
            <dt>{t('incubation.admin.fields.address')}</dt>
            <dd>{addressLines.length ? addressLines.map((l) => <span key={l}>{l}</span>) : <em>{t('incubation.admin.notGiven')}</em>}</dd>
          </div>
          <div><dt>{t('incubation.admin.fields.contactGoal')}</dt><dd>{c.email && (c.addressComplete || website) ? t('incubation.admin.met') : t('incubation.admin.notMet')}</dd></div>
          <div><dt>{t('incubation.admin.fields.firstSaved')}</dt><dd>{when(c.firstSavedAt) || <em>{t('incubation.admin.unknown')}</em>}</dd></div>
          <div><dt>{t('incubation.admin.fields.lastChanged')}</dt><dd>{when(c.updatedAt) || <em>{t('incubation.admin.unknown')}</em>}</dd></div>
          <div><dt>{t('incubation.admin.fields.butrauthUser')}</dt><dd><code>{c.butrauthUserId}</code></dd></div>
        </dl>
      ) : (
        <p className="inc-admin-empty">{t('incubation.admin.noContact')}</p>
      )}
      </div>
      </div>
    </section>
  );
}
