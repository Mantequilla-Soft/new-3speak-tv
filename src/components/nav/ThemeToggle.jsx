import { useAppStore } from "../../lib/store";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import "./ThemeToggle.scss";

// Light / dark switch: a round icon button showing the theme you are in
// (designs 07d, 42b: the account menu's header). A real button, so it is
// reachable from the keyboard.
const ThemeToggle = ({ className = "" }) => {
  const { theme, toggleTheme } = useAppStore();
  const { t } = useTranslation();
  const dark = theme === 'dark';
  const switchLabel = dark ? t('nav.theme.switchToLight') : t('nav.theme.switchToDark');

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={switchLabel}
      title={switchLabel}
    >
      <Icon name={dark ? 'dark_mode' : 'light_mode'} size={20} />
    </button>
  );
};

export default ThemeToggle;
