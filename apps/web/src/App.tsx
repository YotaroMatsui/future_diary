import { AppHeader } from "./app-header";
import { DiaryPage } from "./diary-page";
import { LoginPage } from "./login-page";
import { useFutureDiaryApp } from "./use-future-diary-app";
import { appPaths } from "./future-diary-types";

export const App = () => {
  const app = useFutureDiaryApp();
  const isLoginTransitioning = app.bootstrapping || (app.authLoading && !app.session);
  const showLoginPage = app.appPath === appPaths.login && !app.session;
  const showDiaryPage = app.appPath === appPaths.diary && app.session;

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_0%_0%,oklch(0.96_0.02_239),transparent_46%),radial-gradient(circle_at_100%_0%,oklch(0.98_0.03_230),transparent_40%),linear-gradient(to_bottom,oklch(0.99_0_0),oklch(0.97_0_0))]">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-4">
        <AppHeader
          session={app.session}
          authLoading={app.authLoading}
          bootstrapping={app.bootstrapping}
          onStartGoogleAuth={app.startGoogleAuth}
          onLogout={app.logout}
        />

        {isLoginTransitioning && (
          <div className="flex min-h-[58dvh] items-center justify-center text-sm text-muted-foreground">認証中...</div>
        )}

        {!isLoginTransitioning && showLoginPage && <LoginPage />}

        {!isLoginTransitioning && showDiaryPage && <DiaryPage app={app} />}
      </main>
    </div>
  );
};
