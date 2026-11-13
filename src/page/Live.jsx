import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, Segmented, StatusPill, Thumb } from "../components/v2/ui";
import { Icon } from "../components/v2/Icon";
import { useLiveStreams } from "../hooks/useLiveStreams";
import { useAppStore } from "../lib/store";
import { openpodsEnabledFor } from "../utils/config";
import "./Live.scss";

/** One stream as a tile (26b): the thumbnail with the LIVE pill and the number
 *  of people watching, then the title and the creator. A room that is open but
 *  not broadcasting yet carries a cyan Standby pill and no count. */
function StreamTile({ stream }) {
  const { t } = useTranslation();
  const waiting = !!stream._standby;
  return (
    <li>
      <Link to={`/watch/${stream.roomName}`} className="live-tile" title={stream.title}>
        <Thumb src={stream.thumbnail || undefined} radius={16} className="live-tile-thumb">
          {waiting ? (
            <StatusPill tone="cyan" icon="schedule" className="live-tile-pill">{t("profile.streams.standby")}</StatusPill>
          ) : (
            <StatusPill tone="live" className="live-tile-pill">{t("profile.streams.live")}</StatusPill>
          )}
          {!waiting && (
            <span className="live-tile-count num" title={t("cards.watchingNow", { count: stream.views || 0 })}>
              {stream.views || 0}
            </span>
          )}
        </Thumb>
        <span className="live-tile-text">
          <b>{stream.title || stream.roomName}</b>
          <span>{stream.owner}</span>
        </span>
      </Link>
    </li>
  );
}

/** An OpenPods room (26b): cyan-washed row, podcasts tile, title, people
 *  listening, and Listen. */
function RoomRow({ room }) {
  const { t } = useTranslation();
  return (
    <li>
      <Link to={`/openpods/${room.roomName}`} className="live-room">
        <span className="live-room-icon" aria-hidden="true"><Icon name="podcasts" size={24} /></span>
        <span className="live-room-text">
          <b>{room.title || room.roomName}</b>
          <span className="num">{t("live.grid.listening", { count: room.views || 0 })}</span>
        </span>
        <span className="live-room-go">{t("ads.ticker.listen")}<Icon name="headphones" size={16} /></span>
      </Link>
    </li>
  );
}

/**
 * /live, where the top bar's Live tab leads (20a): the Live grid of 26b. The
 * title with Go live (for the accounts that can host), a Streams | OpenPods |
 * Scheduled track, the live streams as tiles with the OpenPods rooms listed
 * under them, the rooms on their own, and the rooms that are open but not
 * broadcasting yet. An empty state (§11) when nothing is on.
 */
export default function Live() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const all = useLiveStreams({ standby: true });
  const [tab, setTab] = useState("streams");
  const streams = useMemo(() => all.filter((s) => !s._openpodRoom && !s._standby), [all]);
  const rooms = useMemo(() => all.filter((s) => s._openpodRoom && !s._standby), [all]);
  const waiting = useMemo(() => all.filter((s) => s._standby), [all]);
  const canHost = openpodsEnabledFor(user);

  const roomList = (
    <ul className="live-rooms">
      {rooms.map((r) => <RoomRow key={r.roomName} room={r} />)}
    </ul>
  );

  return (
    <div className="live-page">
      <header className="live-page-head">
        <h1>{t("nav.tabs.live")}</h1>
        {canHost && (
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
        className="live-page-tabs"
        options={[
          { value: "streams", label: t("profile.tabs.streams") },
          { value: "rooms", label: t("live.grid.openpods") },
          { value: "scheduled", label: t("cards.status.scheduled") },
        ]}
      />

      {tab === "streams" && (streams.length || rooms.length ? (
        <>
          {streams.length > 0 ? (
            <ul className="live-grid">
              {streams.map((s) => <StreamTile key={s.roomName} stream={s} />)}
            </ul>
          ) : (
            <EmptyState icon="sensors" title={t("feeds.activity.emptyLive")}>{t("live.grid.emptySub")}</EmptyState>
          )}
          {rooms.length > 0 && (
            <section className="live-section" aria-labelledby="live-openpods-label">
              <h2 id="live-openpods-label" className="live-eyebrow">{t("live.grid.openpods")}</h2>
              {roomList}
            </section>
          )}
        </>
      ) : (
        <EmptyState
          icon="sensors"
          title={t("feeds.activity.emptyLive")}
          action={waiting.length > 0 && (
            <Button variant="secondary" size={40} next onClick={() => setTab("scheduled")}>{t("cards.status.scheduled")}</Button>
          )}
        >
          {t("live.grid.emptySub")}
        </EmptyState>
      ))}

      {tab === "rooms" && (rooms.length ? roomList : (
        <EmptyState icon="podcasts" title={t("live.grid.emptyRooms")}>{t("live.grid.emptySub")}</EmptyState>
      ))}

      {tab === "scheduled" && (waiting.length ? (
        <ul className="live-grid">
          {waiting.map((s) => <StreamTile key={s.roomName} stream={s} />)}
        </ul>
      ) : (
        <EmptyState icon="schedule" title={t("live.grid.emptyScheduled")}>{t("live.grid.emptyScheduledSub")}</EmptyState>
      ))}
    </div>
  );
}
