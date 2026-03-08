import { LoaderCircle, LogOut, Sparkles } from "lucide-react";
import { Button } from "./ui-button";
import { appPaths, type AppPath, type SessionState } from "./future-diary-types";

type AppHeaderProps = {
  appPath: AppPath;
  session: SessionState | null;
  authLoading: boolean;
  bootstrapping: boolean;
  onStartGoogleAuth: () => Promise<void>;
  onLogout: () => Promise<void>;
  onNavigate: (path: AppPath) => void;
};

export const AppHeader = ({
  appPath,
  session,
  authLoading,
  bootstrapping,
  onStartGoogleAuth,
  onLogout,
  onNavigate,
}: AppHeaderProps) => (
  <header className="fd-surface rounded-2xl px-4 py-3 backdrop-blur-sm">
    <div className="flex items-center justify-between gap-3">
      <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
        <Sparkles className="h-4 w-4 text-primary" />
        Future Diary
      </h1>
      {session ? (
        <div className="flex items-center gap-1.5">
          <Button
            variant={appPath === appPaths.diary ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              onNavigate(appPaths.diary);
            }}
          >
            日記
          </Button>
          <Button
            variant={appPath === appPaths.reflection ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              onNavigate(appPaths.reflection);
            }}
          >
            振り返り
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void onLogout()} disabled={authLoading}>
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            void onStartGoogleAuth();
          }}
          disabled={authLoading || bootstrapping}
        >
          {authLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Login
        </Button>
      )}
    </div>
  </header>
);
