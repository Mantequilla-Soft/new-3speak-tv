import { useCallback, useRef, useState } from 'react';
import { toastIn } from '../../utils/toast';
import { Camera, MapPin, Loader2 } from 'lucide-react';
import { saveProfileToHive } from '../../utils/profileMeta';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { setAvatarOverride, clearAvatarOverride, useAvatarUrl } from '../../utils/avatarCache';
import defaultCover from '../../assets/image/default-cover.svg';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

// The profile picture / display name / bio / location block, shared by the
// new-user welcome flow and the "Edit" button on your own profile page.

export const NAME_MAX = 30;
export const ABOUT_MAX = 160;
export const LOCATION_MAX = 30;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const EMPTY = { name: '', about: '', location: '', profile_image: '', cover_image: '' };
const FIELDS = ['name', 'about', 'location', 'profile_image', 'cover_image'];

/**
 * Form state + upload + save for the profile block. `seed` fills it from an
 * already-fetched Hive profile; `save` broadcasts and resolves true on success.
 */
export function useProfileEditor(username) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const seed = useCallback((profile) => {
    setForm({
      name: profile?.name || '',
      about: profile?.about || '',
      location: profile?.location || '',
      profile_image: profile?.profile_image || '',
      cover_image: profile?.cover_image || '',
    });
  }, []);

  const setField = useCallback(
    (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value })),
    [],
  );

  // `field` is 'profile_image' or 'cover_image' — same upload path, different slot.
  const pickImage = useCallback((field = 'profile_image') => async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('That image is over 8MB, please pick a smaller one');
      return;
    }
    setUploading(true);
    try {
      // preferStatic: delegated logins (ButrAuth, HiveSigner) can't sign the
      // hive.blog challenge client-side, so skip that fallback.
      const url = await uploadThumbnail(file, username, { preferStatic: true });
      setForm((f) => ({ ...f, [field]: url }));
    } catch (err) {
      toast.error(err?.message || 'Could not upload that image');
    } finally {
      setUploading(false);
    }
  }, [username]);

  const hasAnything = FIELDS.some((k) => String(form[k] || '').trim());

  const save = useCallback(async (successMessage = 'Profile saved') => {
    if (!username) return false;
    setSaving(true);
    try {
      await saveProfileToHive(username, form);
      // Render the picture we just uploaded straight away: the hive avatar
      // proxy would keep serving the old one for a while.
      if (form.profile_image) setAvatarOverride(username, form.profile_image);
      else clearAvatarOverride(username);
      toast.success(successMessage);
      return true;
    } catch (e) {
      toast.error(e?.message || 'Could not save your profile');
      return false;
    } finally {
      setSaving(false);
    }
  }, [username, form]);

  return { form, seed, setForm, setField, pickImage, uploading, saving, hasAnything, save };
}

export default function ProfileFields({ username, form, setField, pickImage, uploading, saving }) {
  const fileRef = useRef(null);
  const coverRef = useRef(null);
  const currentAvatar = useAvatarUrl(username, null);
  const avatar = form.profile_image || currentAvatar;
  const cover = form.cover_image || defaultCover;

  return (
    <>
      {/* Banner first: it's the biggest thing on a profile, so it reads as the
          headline choice rather than an afterthought below the text fields. */}
      <div className="welcome-cover-row">
        <button
          type="button"
          className="welcome-cover"
          onClick={() => coverRef.current && coverRef.current.click()}
          disabled={uploading || saving}
          aria-label="Upload a profile banner"
          style={{ backgroundImage: `url(${cover})` }}
        >
          <span className="welcome-cover-action">
            {uploading ? <Loader2 size={15} className="welcome-spin" /> : <Camera size={15} />}
            {form.cover_image ? 'Change banner' : 'Add a banner'}
          </span>
        </button>
        <span className="welcome-cover-hint">
          Best at <strong>2800 × 684</strong> px (or any 4:1 image). Keep the important part
          centred: the sides crop on narrow screens and your name sits over the lower left.
        </span>
        <input
          ref={coverRef}
          type="file"
          accept="image/*"
          onChange={pickImage('cover_image')}
          style={{ display: 'none' }}
        />
      </div>

      <div className="welcome-avatar-row">
        <button
          type="button"
          className="welcome-avatar"
          onClick={() => fileRef.current && fileRef.current.click()}
          disabled={uploading || saving}
          aria-label="Upload a profile picture"
        >
          <img src={avatar} alt="" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
          <span className="welcome-avatar-badge">
            {uploading ? <Loader2 size={15} className="welcome-spin" /> : <Camera size={15} />}
          </span>
        </button>
        <div className="welcome-avatar-text">
          <strong>Profile picture</strong>
          <span>
            {uploading
              ? 'Uploading…'
              : 'A face or a logo works best. Square, 400 × 400 px or larger. Up to 8MB.'}
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={pickImage('profile_image')} style={{ display: 'none' }} />
      </div>

      <label className="welcome-field">
        <span className="welcome-label">Display name</span>
        <input
          type="text"
          value={form.name}
          onChange={setField('name')}
          maxLength={NAME_MAX}
          placeholder={`How should we call you? (@${username})`}
          disabled={saving}
        />
      </label>

      <label className="welcome-field">
        <span className="welcome-label">
          Short bio
          <em>{form.about.length}/{ABOUT_MAX}</em>
        </span>
        <textarea
          rows={3}
          value={form.about}
          onChange={setField('about')}
          maxLength={ABOUT_MAX}
          placeholder="What do you make, and what should people expect from you?"
          disabled={saving}
        />
      </label>

      <label className="welcome-field">
        <span className="welcome-label">Location <em>optional</em></span>
        <div className="welcome-input-icon">
          <MapPin size={15} />
          <input
            type="text"
            value={form.location}
            onChange={setField('location')}
            maxLength={LOCATION_MAX}
            placeholder="Where in the world are you?"
            disabled={saving}
          />
        </div>
      </label>
    </>
  );
}
