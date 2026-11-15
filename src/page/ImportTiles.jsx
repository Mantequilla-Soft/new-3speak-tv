import { SettingRow, Toggle, Icon } from "../components/v2/ui";
import { cx } from "../components/v2/helpers";
import SettingInfo from "../components/embed-studio/SettingInfo";
// The rewards sheet's choice list (the studio's stylesheet is not loaded here).
import "../components/embed-studio/OptionSheet.scss";
// Styles: YoutubeImportPage.scss (.yt-batch-pick, .yt-batch-setting).

// The settings rows of the importer's forms (batch, automatic import).

/** One on/off setting: a SettingRow with a Toggle (STYLE_GUIDE §11). */
export function ToggleTile({ label, info, hint, checked, onChange, disabled }) {
  return (
    <SettingRow
      className="yt-batch-setting"
      title={<>{label}<SettingInfo title={label}>{info}</SettingInfo></>}
      sub={hint}
      control={<Toggle checked={!!checked} onChange={onChange} disabled={disabled} label={label} />}
    />
  );
}

/** A setting that opens a picker: title, hint and the current value. */
export function PickTile({ label, info, hint, value, onOpen, disabled, className }) {
  const open = () => { if (!disabled) onOpen(); };
  return (
    <div
      className={cx('yt-batch-pick', disabled && 'is-disabled', className)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      <div className="yt-batch-pick__body">
        <b>{label}<SettingInfo title={label}>{info}</SettingInfo></b>
        <span>{hint}</span>
      </div>
      <span className="yt-batch-pick__value">{value}</span>
      <Icon name="chevron_right" size={18} className="yt-batch-pick__go" />
    </div>
  );
}
