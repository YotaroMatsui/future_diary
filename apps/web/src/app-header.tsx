import { LoaderCircle, LogOut, Sparkles } from "lucide-react";
import { Button } from "./ui-button";
import type { SessionState } from "./future-diary-types";

type AppHeaderProps = {
  session: SessionState | null;
  authLoading: boolean;
  bootstrapping: boolean;
  onStartGoogleAuth: () => Promise<void>;
  onLogout: () => Promise<void>;
};

export const AppHeader = ({
  session,
  authLoading,
  bootstrapping,
  onStartGoogleAuth,
  onLogout,
}: AppHeaderProps) => (
  <header className="rounded-2xl border border-border/80 bg-card/90 px-4 py-3 backdrop-blur-sm">
    <div className="flex items-center justify-between gap-3">
      <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
        <Sparkles className="h-4 w-4 text-primary" />
        Future Diary
      </h1>
      {session ? (
        <Button variant="ghost" size="sm" onClick={() => void onLogout()} disabled={authLoading}>
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
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
