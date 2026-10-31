import { useSyncExternalStore } from 'react';

const subscribe = (cb) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Whether the browser says it has a connection; re-renders when that changes. */
export default function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine !== false, () => true);
}
