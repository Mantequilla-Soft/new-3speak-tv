import { useEffect, useRef, useState } from "react";
import { getContentData } from "../utils/hiveUtils";
import { useAppStore } from "../lib/store";


function LazyPayout({ author, permlink, setVotersNum, setHasVoted1 }) {
  const [payout, setPayout] = useState(null);
  const ref = useRef();
  const {user:active_user} = useAppStore();

  useEffect(() => {
    const observer = new IntersectionObserver(async (entries) => {
      if (entries[0].isIntersecting) {
        try {
          const data = await getContentData(active_user, author, permlink, setHasVoted1);
          if (data) {
            setPayout(data.payout);
            if (setVotersNum) setVotersNum(data.voters);
            if (setHasVoted1) setHasVoted1(data.isVoted);
          }
        } catch (err) {
          console.error("Error fetching payout:", err);
        } finally {
          observer.disconnect(); // stop once loaded
        }
      }
    });

    if (ref.current) observer.observe(ref.current);

    return () => observer.disconnect();
  }, [author, permlink, active_user, setVotersNum, setHasVoted1]);

  return (
    <div ref={ref}>
      {/* Money: accent + Roboto Mono (the global .money class) */}
      <span className="money">${payout ?? "…"}</span>
      {/* <p>Voters: {voters ?? "…"}</p> */}
    </div>
  );
}

export default LazyPayout;
