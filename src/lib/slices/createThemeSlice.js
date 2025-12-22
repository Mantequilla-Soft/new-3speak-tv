/**
 * Theme Slice for Zustand Store
 * Manages dark/light mode state with localStorage persistence
 */

export const createThemeSlice = (set, get) => ({
  // Theme state: 'light' | 'dark' | 'system'
  theme: 'light',
  
  // Computed: actual theme based on system preference if theme is 'system'
  getEffectiveTheme: () => {
    const { theme } = get();
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  },

  // Set theme and apply to DOM
  setTheme: (newTheme) => {
    set({ theme: newTheme });
    
    // Apply theme to document
    const effectiveTheme = newTheme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : newTheme;
    
    document.documentElement.setAttribute('data-theme', effectiveTheme);
  },

  // Toggle between light and dark
  toggleTheme: () => {
    const { theme, setTheme } = get();
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  },

  // Initialize theme on app load
  initializeTheme: () => {
    const { theme, setTheme } = get();
    // Re-apply the persisted theme to the DOM
    setTheme(theme);
    
    // Listen for system theme changes if using system preference
    if (theme === 'system') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const { theme: currentTheme } = get();
        if (currentTheme === 'system') {
          document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        }
      });
    }
  },
});
