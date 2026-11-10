import { create } from 'zustand';

// Transient (NOT persisted) UI state for the "contact 3Speak support" block
// modal, shown when a creator is banned (login) or not allowed to upload.
// reason: 'banned' | 'upload' | null
// extra (optional): { note } = the admin's block note to quote,
// { onClose } = called once when the person closes the popup.
export const useSupportBlock = create((set) => ({
  block: null,
  showSupportBlock: (reason, extra) => set({ block: extra ? { reason, ...extra } : { reason } }),
  hideSupportBlock: () => set({ block: null }),
}));
