import { CalendarDays, CheckCircle2, LoaderCircle, LogOut, Sparkles } from "lucide-react";
import { Button } from "./ui-button";
import { appPaths, type AppPath, type SessionState } from "./future-diary-types";

type AppHeaderProps = {
  appPath: AppPath;
  session: SessionState | null;
  googleCalendarConnected: boolean;
  authLoading: boolean;
  bootstrapping: boolean;
  onStartGoogleAuth: () => Promise<void>;
  onStartGoogleCalendarAuth: () => Promise<void>;
  onLogout: () => Promise<void>;
  onNavigate: (path: AppPath) => void;
};

export const AppHeader = ({
  appPath,
  session,
  googleCalendarConnected,
  authLoading,
  bootstrapping,
  onStartGoogleAuth,
  onStartGoogleCalendarAuth,
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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          </div>
          <Button
            variant={googleCalendarConnected ? "outline" : "default"}
            size="sm"
            onClick={() => {
              if (!googleCalendarConnected) {
                void onStartGoogleCalendarAuth();
              }
            }}
            disabled={authLoading || bootstrapping || googleCalendarConnected}
          >
            {authLoading && !googleCalendarConnected ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : googleCalendarConnected ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <CalendarDays className="h-4 w-4" />
            )}
            {googleCalendarConnected ? "Calendar連携済み" : "Calendar連携"}
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
