import { useAppStore } from "../../lib/store";
import { FiSun, FiMoon } from "react-icons/fi";
import "./ThemeToggle.scss";

const ThemeToggle = () => {
  const { theme, toggleTheme } = useAppStore();

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <div className="toggle-track">
        <FiSun className="icon sun-icon" />
        <FiMoon className="icon moon-icon" />
        <div className={`toggle-thumb ${theme === 'dark' ? 'dark' : ''}`} />
      </div>
    </button>
  );
};

export default ThemeToggle;
