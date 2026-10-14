/**
 * Stream templates ("Go live from OBS") on the hangouts API.
 *
 * A template is a saved stream setup (title, description, thumbnail, tags,
 * boost, recording, Hive announcement). OBS connects over WHIP to the
 * template's own address (`whipUrl` = `<whipBase>/<owner>/<slug>`, the slug
 * built from the template's NAME) with the user's ONE stream secret as the
 * Bearer token; the hangouts server then creates the room and goes live itself.
 *
 * Templates live on ONE deployment (VITE_HANGOUTS_TEMPLATES_API_URL, else
 * VITE_HANGOUTS_API_URL), never the least-loaded pick used for browser rooms:
 * OBS connects there and that server creates the room.
 *
 * 🚨 The stream secret is a credential: never log it, never put it in a toast,
 * a URL or storage. It only ever lives in component state on the templates page.
 */

// Normally the same deployment the session token comes from. A separate base
// is allowed for a rollout where only one deployment has the templates routes
// yet (session tokens are accepted by every deployment that shares the
// SESSION_SECRET, as the premium API already relies on).
const API_URL = (import.meta.env.VITE_HANGOUTS_TEMPLATES_API_URL || import.meta.env.VITE_HANGOUTS_API_URL || '')
  .replace(/\/$/, '');

export const TEMPLATE_LIMITS = {
  name: 60,
  title: 120,
  description: 5000,
  tags: 10,
  tagLength: 40,
  beneficiaries: 8,
  templates: 20,
};

/** An API error that keeps the HTTP status and the server's `error` code. */
export class TemplateApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code || null;
  }
}

async function call(token, path, { method = 'GET', body } = {}) {
  if (!API_URL) throw new TemplateApiError(0, 'not_configured');
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Fastify's sensible errors put a sentence in `message` and the code in
    // `error`; our own routes put the code in `error`.
    throw new TemplateApiError(res.status, data?.error || null, data?.message || data?.error);
  }
  return data;
}

export const listTemplates = (token) => call(token, '/templates');
export const createTemplate = (token, input) => call(token, '/templates', { method: 'POST', body: input });
export const updateTemplate = (token, id, input) => call(token, `/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
export const deleteTemplate = (token, id) => call(token, `/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getTemplateStatus = (token, id) => call(token, `/templates/${encodeURIComponent(id)}/status`);
export const getStreamSecret = (token) => call(token, '/stream-secret');
export const resetStreamSecret = (token) => call(token, '/stream-secret/reset', { method: 'POST', body: {} });

/**
 * The address part a template name becomes. Mirrors the server's rule
 * (lowercase a-z0-9 and dashes, at most 40 characters) for the live preview under the name field; the
 * server's answer (`template.slug`) is what counts once saved.
 */
export function slugifyTemplateName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** A fresh template form, with the same defaults as the browser create-stream form. */
export function emptyTemplate() {
  return {
    name: '',
    title: '',
    description: '',
    thumbnail: '',
    tags: [],
    language: 'en',
    visibility: 'public',
    boost: { enabled: true, minBoostUsd: 0.1, creatorPayoutAccount: '' },
    recording: { publishVod: false, allowClips: true },
    announce: {
      enabled: true,
      community: 'hive-181335',
      communityTitle: '',
      declineRewards: false,
      rewardPowerup: false,
      beneficiaries: [],
    },
  };
}

/** Template (as the server returns it) → form state, filling any gaps. */
export function templateToForm(tpl) {
  const base = emptyTemplate();
  if (!tpl) return base;
  return {
    name: tpl.name || '',
    title: tpl.title || '',
    description: tpl.description || '',
    thumbnail: tpl.thumbnail || '',
    tags: Array.isArray(tpl.tags) ? tpl.tags : [],
    language: tpl.language || 'en',
    visibility: tpl.visibility || 'public',
    boost: { ...base.boost, ...(tpl.boost || {}) },
    recording: { ...base.recording, ...(tpl.recording || {}) },
    announce: { ...base.announce, ...(tpl.announce || {}) },
  };
}

/** Form state → the TemplateInput body the API takes. */
export function formToInput(form, { isPremium }) {
  const minUsd = Number(form.boost.minBoostUsd);
  return {
    name: form.name.trim(),
    title: form.title.trim(),
    description: form.description,
    thumbnail: form.thumbnail || '',
    tags: form.tags,
    language: form.language || 'en',
    visibility: form.visibility,
    boost: {
      enabled: !!form.boost.enabled,
      minBoostUsd: Number.isFinite(minUsd) ? Math.max(0, minUsd) : 0,
      creatorPayoutAccount: (form.boost.creatorPayoutAccount || '').trim().toLowerCase().replace(/^@/, ''),
    },
    // Pro-only perks. The server enforces this too; sending false for a free
    // account just keeps the stored template honest.
    recording: {
      publishVod: !!isPremium && !!form.recording.publishVod,
      allowClips: !!isPremium && !!form.recording.allowClips,
    },
    announce: {
      enabled: !!form.announce.enabled,
      community: form.announce.community || 'hive-181335',
      communityTitle: form.announce.communityTitle || '',
      declineRewards: !!form.announce.declineRewards,
      rewardPowerup: !!form.announce.rewardPowerup,
      beneficiaries: (form.announce.beneficiaries || [])
        .filter((b) => b && b.account && b.weight > 0)
        .slice(0, TEMPLATE_LIMITS.beneficiaries),
    },
  };
}
