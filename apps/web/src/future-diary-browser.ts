import { appPaths, type AppPath } from "./future-diary-types";

const googleAuthRedirectUriFromEnv =
  typeof import.meta.env.VITE_GOOGLE_AUTH_REDIRECT_URI === "string"
    ? import.meta.env.VITE_GOOGLE_AUTH_REDIRECT_URI.trim()
    : "";

export const normalizeAppPath = (hash: string): AppPath =>
  hash === appPaths.diary ? appPaths.diary : appPaths.login;

export const readLocalStorageString = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeLocalStorageString = (key: string, value: string): void => {
  try {
    if (value.length === 0) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
};

export const resolveGoogleAuthRedirectUri = (url: URL): string => {
  if (googleAuthRedirectUriFromEnv.length === 0) {
    return url.origin;
  }

  try {
    new URL(googleAuthRedirectUriFromEnv);
    return googleAuthRedirectUriFromEnv;
  } catch {
    return url.origin;
  }
};

export const clearOauthParamsInUrl = (url: URL): void => {
  const keys = ["code", "state", "scope", "authuser", "prompt"] as const;

  for (const key of keys) {
    url.searchParams.delete(key);
  }
};
