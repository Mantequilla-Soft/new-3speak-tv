import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Card3 from "../components/Cards/Card3";
import { Button, EmptyState, Segmented } from "../components/v2/ui";
import { Icon } from "../components/v2/Icon";
import { useLiveStreams } from "../hooks/useLiveStreams";
import { useAppStore } from "../lib/store";
import { openpodsEnabledFor } from "../utils/config";
import "./Live.scss";

/**
 * /live, where the top bar's Live tab leads (20a): what is live right now, as
 * on the Live board of 26b. Streams as cards (LIVE pill, people watching), the
 * group-chat rooms (OpenPods) as rows to listen in. "Go live" for the accounts
 * that can host. The board's "Scheduled" tab is left out: nothing lists
 * upcoming streams yet.
 */
export default function Live() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const live = useLiveStreams();
  const [tab, setTab] = useState("streams");
  const streams = useMemo(() => live.filter((s) => !s._openpodRoom), [live]);
  const rooms = useMemo(() => live.filter((s) => s._openpodRoom), [live]);

  return (
    <div className="live-page">
      <header className="live-page-head">
        <h1>{t("nav.tabs.live")}</h1>
        {openpodsEnabledFor(user) && (
          <Button as={Link} to="/openpods?create=1&mode=standalone" variant="primary" size={56} trailing="sensors" className="live-page-go">
            {t("live.obs.steps.goLive")}
          </Button>
        )}
      </header>

      <Segmented
        block={false}
        label={t("nav.tabs.live")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "streams", label: t("profile.tabs.streams"), count: streams.length || undefined },
          { value: "rooms", label: "OpenPods", count: rooms.length || undefined },
        ]}
      />

      {tab === "streams" && (streams.length ? (
        <Card3 videos={streams} />
      ) : (
        <EmptyState icon="sensors" title={t("feeds.activity.emptyLive")} />
      ))}

      {tab === "rooms" && (rooms.length ? (
        <ul className="live-page-rooms">
          {rooms.map((r) => (
            <li key={r.roomName}>
              <Link to={`/openpods/${r.roomName}`} className="live-page-room">
                <span className="live-page-room-icon" aria-hidden="true"><Icon name="podcasts" size={24} /></span>
                <span className="live-page-room-text">
                  <b>{r.title}</b>
                  <span>{t("cards.watchingNow", { count: r.views || 0 })}</span>
                </span>
                <span className="live-page-room-go">{t("ads.ticker.listen")}<Icon name="headphones" size={18} /></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="podcasts" title={t("feeds.activity.emptyLive")} />
      ))}
    </div>
  );
}
