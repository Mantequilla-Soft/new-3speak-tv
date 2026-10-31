import { useEffect, useState } from 'react';

// The Hive galaxy (page/Galaxy.jsx) is a desktop feature: on a phone its
// controls and lists leave too little sky to explore. Below this width the
// page says so instead of scanning, and the profile buttons leading there
// are hidden.
export const GALAXY_MIN_WIDTH = 900;
const QUERY = `(min-width: ${GALAXY_MIN_WIDTH}px)`;

export default function useGalaxyFits() {
  const [fits, setFits] = useState(() => typeof window === 'undefined' || window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setFits(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return fits;
}
