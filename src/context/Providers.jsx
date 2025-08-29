// import { AuthProvider } from "./AuthContext";
import { useAppStore } from "../lib/store";
import { UploadProvider } from "./UploadContext";
// import { ThemeProvider } from "./ThemeContext";

export const AppProviders = ({ children }) => {
    const { user } = useAppStore();
  return (
    // <AuthProvider>
      <UploadProvider key={user}>
        {/* <ThemeProvider> */}
          {children}
        {/* </ThemeProvider> */}
      </UploadProvider>
    // </AuthProvider>
  );
};
