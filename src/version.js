// Single source of truth for the app version shown to users.
// Bump this on every user-facing release. When a returning visitor's stored
// version differs from this, they upgraded — see checkAppVersion() in
// utils/appVersion.js, which surfaces the previous version via the store's
// `appUpdatedFrom` so a changelog / "what's new" prompt can be shown later.
// First-time visitors (no stored version) never trigger that prompt.
export const APP_VERSION = '1.78.65';
