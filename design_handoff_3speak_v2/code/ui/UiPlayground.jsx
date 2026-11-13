// Live demo of every primitive, in both themes. Mount it on a dev-only route (e.g. /dev/ui)
// and compare it against the design files. If they don't match, the primitive is wrong, not the design.
import { useState } from "react";
import { Bell, Bookmark, ChevronDown, Info, MessageCircle, Share2, ThumbsUp, TriangleAlert, Upload, Wallet } from "lucide-react";
import { Avatar, Banner, Button, Card, Chip, ChoiceCard, ConfirmBar, Dialog, DockTile, EmptyState, Eyebrow, Field, IconButton, Island, Progress, Segmented, SettingRow, StatTile, StatusPill, Thumb, Toggle } from "./ui";

export default function UiPlayground() {
  const [theme, setTheme] = useState("dark");
  const [seg, setSeg] = useState("Supporters");
  const [pick, setPick] = useState("default");
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(false);
  return (
    <div data-theme={theme} style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh", padding: 32, display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", alignItems: "start" }}>
      <Card><Eyebrow>Theme</Eyebrow><Segmented options={["dark", "light"]} value={theme} onChange={setTheme} /></Card>
      <Card style={{ display: "grid", gap: 8 }}>
        <Eyebrow>Buttons</Eyebrow>
        <Button variant="primary" size={48} block next>Publish</Button>
        <Button variant="cyan" block>Join community</Button>
        <Button>Secondary</Button> <Button variant="danger">Remove</Button> <Button variant="ghost" icon={Share2}>Share</Button>
        <div style={{ display: "flex", gap: 6 }}><IconButton icon={Bell} label="Notifications" /><IconButton icon={Bookmark} label="Save" size={32} /></div>
      </Card>
      <Card style={{ display: "grid", gap: 10 }}>
        <Eyebrow>Chips and tabs</Eyebrow>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Chip selected>All</Chip><Chip>Videos</Chip><Chip count={12}>Shorts</Chip></div>
        <Segmented options={[{ value: "Supporters", label: "Supporters", count: 10 }, { value: "Voters", label: "Voters", count: 38 }]} value={seg} onChange={setSeg} />
      </Card>
      <Card style={{ display: "grid", gap: 10 }}>
        <Eyebrow>Forms</Eyebrow>
        <Field label="Title" placeholder="What is this video about?" hint="Up to 120 characters" />
        <Field label="Recipient" defaultValue="pancasona" error="That account does not exist on Hive." />
        <Field label="Description" as="textarea" optional />
        <ChoiceCard selected={pick === "default"} onClick={() => setPick("default")} icon={Wallet} title="Default 50% / 50%" sub="Half HBD, half Hive Power" />
        <ChoiceCard selected={pick === "power"} onClick={() => setPick("power")} icon={Upload} title="Power up 100%" sub="All rewards as Hive Power" tone="cyan" />
        <SettingRow title="Allow remix and clip" sub="You are credited as the original author" control={<Toggle checked={on} onChange={setOn} label="Allow remix" />} />
      </Card>
      <Card style={{ display: "grid", gap: 10 }}>
        <Eyebrow>Status</Eyebrow>
        <div style={{ display: "flex", gap: 6 }}><StatusPill tone="live">● LIVE</StatusPill><StatusPill tone="cyan">Approved</StatusPill><StatusPill tone="accent">Failed</StatusPill><StatusPill>Draft</StatusPill></div>
        <Banner tone="info" icon={Info} title="Heads up.">Watch time is tracked since March.</Banner>
        <Banner tone="warn" icon={TriangleAlert} title="Out of resource credits.">They refill on their own.</Banner>
        <Progress value={64} label="Upload" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}><StatTile label="Views" value="9.2K" /><StatTile label="Watch time" value="312h" /><StatTile label="Payout" value="$6.49" /></div>
      </Card>
      <Card style={{ display: "grid", gap: 10 }}>
        <Eyebrow>Media and people</Eyebrow>
        <Thumb><StatusPill tone="live">● LIVE</StatusPill></Thumb>
        <div style={{ display: "flex", gap: 8 }}><Avatar name="birdwatcher" size={40} ring="accent" /><Avatar name="jza" /><Avatar name="marta" size={28} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}><DockTile icon={ThumbsUp} label="218" active /><DockTile icon={MessageCircle} label="42" /><DockTile icon={Wallet} label="Tip" /><DockTile icon={Share2} label="Share" /><DockTile icon={ChevronDown} label="More" /></div>
      </Card>
      <EmptyState icon={Upload} title="No videos yet" action={<Button variant="primary" next>Upload a video</Button>}>Upload your first video and it lands right here.</EmptyState>
      <Card><Button variant="inverse" onClick={() => setOpen(true)}>Open dialog / sheet</Button></Card>
      <Dialog open={open} onClose={() => setOpen(false)} title="Send a tip to @birdwatcher" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" next block>Send 5 HBD</Button></>}>
        <Segmented options={["HIVE / HBD", "Lightning", "More"]} value="HIVE / HBD" />
        <Field label="Amount" defaultValue="5.000" />
      </Dialog>
      <Island icon={Bell} tone="cyan">Saved to Watch Later</Island>
      <ConfirmBar actions={<><Button size={32} variant="ghost">Undo</Button></>}>Removed from playlist</ConfirmBar>
    </div>
  );
}
