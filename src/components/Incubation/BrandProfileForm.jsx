import { useEffect, useRef, useState } from 'react';
import { useProfileEditor } from '../WelcomePrompt/ProfileFields';
import { fetchMyIncubationProfile, saveIncubationProfile, handleAvatar, currentHandle } from '../../lib/incubation';
import './AdvertiserContactForm.scss';

/**
 * An advertiser's brand profile, filled in right inside the "Set up your brand
 * profile" goal: brand name, what the brand does, logo and website. Nothing else.
 *
 * Kept as small as it can be on purpose. The general profile editor asks for a
 * person's details (location, cover image) that a brand does not need here, and a
 * modal behind "Edit profile" is one more place to find. No banner, by the owner's
 * call (2026-10-01).
 *
 * Saved through the SAME editor hook and the same endpoint as "Edit profile", so the
 * two cannot drift. Saving replaces the stored profile, which is why the hook carries
 * every field (an existing cover image or location survives a save from here) and
 * why the interests are read and sent back too.
 *
 * Public: this is the warm-up profile, shown to others and moved to the Hive account
 * at graduation. Private details (email, address) live in AdvertiserContactForm.
 */
export default function BrandProfileForm() {
  const interestsRef = useRef([]);
  const [loaded, setLoaded] = useState(false);
  const { form, seed, setField, pickImage, uploading, saving, save } = useProfileEditor(null, {
    onSave: (f) => saveIncubationProfile(f, interestsRef.current),
  });

  useEffect(() => {
    let alive = true;
    fetchMyIncubationProfile()
      .then((mine) => {
        if (!alive) return;
        interestsRef.current = mine.interests || [];
        seed(mine.profile || {});
      })
      .catch(() => { /* start from an empty form */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [seed]);

  const website = String(form.website || '').trim();
  const websiteOk = !website || /^https?:\/\/[^\s/]+\.[^\s]+/i.test(website);

  async function onSubmit(e) {
    e.preventDefault();
    if (!loaded || saving || uploading || !websiteOk) return;
    await save('Brand profile saved');
  }

  return (
    <form className="inc-contact" onSubmit={onSubmit}>
      <label className="inc-contact-field">
        <span>Brand name</span>
        <input value={form.name} onChange={setField('name')} placeholder="Your brand or company" maxLength={60} disabled={!loaded} />
      </label>

      <label className="inc-contact-field">
        <span>What your brand does</span>
        <textarea
          rows={3}
          value={form.about}
          onChange={setField('about')}
          placeholder="One or two sentences viewers will understand."
          maxLength={300}
          disabled={!loaded}
        />
      </label>

      <div className="inc-contact-field">
        <span>Logo</span>
        <div className="inc-brand-logo">
          <img src={form.profile_image || handleAvatar(currentHandle())} alt="" />
          <label className="inc-task-cta inc-brand-upload">
            {uploading ? 'Uploading…' : (form.profile_image ? 'Replace logo' : 'Upload logo')}
            <input type="file" accept="image/*" onChange={pickImage('profile_image')} disabled={!loaded || uploading} hidden />
          </label>
        </div>
        <span className="inc-contact-hint">Shown as a circle next to your ads, so a square image works best.</span>
      </div>

      <label className="inc-contact-field">
        <span>Website <em>optional if you give us your address</em></span>
        <input
          type="url"
          inputMode="url"
          value={form.website}
          onChange={setField('website')}
          placeholder="https://yourbrand.com"
          disabled={!loaded}
        />
        {!websiteOk ? <span className="inc-contact-error">Use a full address starting with https://</span> : null}
      </label>

      <button type="submit" className="inc-task-cta" disabled={!loaded || saving || uploading || !websiteOk}>
        {saving ? 'Saving…' : 'Save brand profile'}
      </button>
    </form>
  );
}
