import { useAppStore } from "../../lib/store";
import { useTranslation } from "react-i18next";
import { FiSun, FiMoon } from "react-icons/fi";
import "./ThemeToggle.scss";

const ThemeToggle = () => {
  const { theme, toggleTheme } = useAppStore();
  const { t } = useTranslation();
  const switchLabel = theme === 'dark' ? t('nav.theme.switchToLight') : t('nav.theme.switchToDark');

  return (
    <div
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={switchLabel}
      title={switchLabel}
    >
      <div className="toggle-track">
        <FiSun className="icon sun-icon" />
        <FiMoon className="icon moon-icon" />
        <div className={`toggle-thumb ${theme === 'dark' ? 'dark' : ''}`} />
      </div>
    </div>
  );
};

export default ThemeToggle;
