import { AppHeader } from "./app-header";
import { DiaryPage } from "./diary-page";
import { LoginPage } from "./login-page";
import { ReflectionPage } from "./reflection-page";
import { useFutureDiaryApp } from "./use-future-diary-app";
import { appPaths } from "./future-diary-types";

export const App = () => {
  const app = useFutureDiaryApp();
  const isLoginTransitioning = app.bootstrapping || (app.authLoading && !app.session);
  const showLoginPage = app.appPath === appPaths.login && !app.session;
  const showDiaryPage = app.appPath === appPaths.diary && app.session;
  const showReflectionPage = app.appPath === appPaths.reflection && app.session;

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_0%_0%,oklch(0.96_0.02_239),transparent_46%),radial-gradient(circle_at_100%_0%,oklch(0.98_0.03_230),transparent_40%),linear-gradient(to_bottom,oklch(0.99_0_0),oklch(0.97_0_0))]">
      <main className="fd-page">
        <AppHeader
          appPath={app.appPath}
          session={app.session}
          googleCalendarConnected={app.googleCalendarConnected}
          authLoading={app.authLoading}
          bootstrapping={app.bootstrapping}
          onStartGoogleAuth={app.startGoogleAuth}
          onStartGoogleCalendarAuth={app.startGoogleCalendarAuth}
          onLogout={app.logout}
          onNavigate={(path) => {
            if (path === appPaths.reflection) {
              app.navigateToReflection();
              return;
            }

            app.navigateToDiary();
          }}
        />

        {isLoginTransitioning && (
          <section className="fd-surface">
            <div className="flex min-h-[58dvh] items-center justify-center text-sm text-muted-foreground">認証中...</div>
          </section>
        )}

        {!isLoginTransitioning && showLoginPage && <LoginPage />}

        {!isLoginTransitioning && showDiaryPage && <DiaryPage app={app} />}

        {!isLoginTransitioning && showReflectionPage && (
          <ReflectionPage
            model={app.reflectionModel}
            insight={app.reflectionInsight}
            loading={app.reflectionLoading}
            saving={app.reflectionSaving}
            errorMessage={app.errorMessage}
            onChangeDiaryPurpose={app.changeDiaryPurpose}
            onChangeDiaryStyle={app.changeDiaryStyle}
            onChangeOpeningPhrase={app.changeOpeningPhrase}
            onChangeClosingPhrase={app.changeClosingPhrase}
            onChangeMaxParagraphs={app.changeMaxParagraphs}
            onChangeAvoidCopyingFromFragments={app.changeAvoidCopyingFromFragments}
            onResetPrompt={app.resetReflectionPrompt}
            onSave={app.saveReflectionModel}
            onReset={app.resetReflectionModel}
            onRefreshInsight={app.refreshReflectionInsight}
          />
        )}
      </main>
    </div>
  );
};
