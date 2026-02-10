import type { Result, StyleHints } from "./types";

export type UserModelV1 = {
  version: 1;
  intent: string;
  styleHints: StyleHints;
  preferences: {
    avoidCopyingFromFragments: boolean;
  };
};

export type UserModelParseError =
  | { type: "INVALID_JSON"; message: string }
  | { type: "INVALID_MODEL"; message: string };

export const defaultStyleHints: StyleHints = {
  openingPhrases: ["今日は無理をせず、少しずつ整えていく一日にしたい。"],
  closingPhrases: ["夜に事実を追記して、確定日記にする。"],
  maxParagraphs: 2,
} as const;

export const defaultUserModel: UserModelV1 = {
  version: 1,
  intent: "",
  styleHints: defaultStyleHints,
  preferences: {
    avoidCopyingFromFragments: true,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const normalizeStringArray = (value: unknown, opts: { maxItems: number; maxLength: number }): Result<string[], string> => {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: "must be an array" };
  }

  if (value.length > opts.maxItems) {
    return { ok: false, error: `must have at most ${opts.maxItems} items` };
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return { ok: false, error: "must contain only strings" };
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > opts.maxLength) {
      return { ok: false, error: `each item must be at most ${opts.maxLength} characters` };
    }
    result.push(trimmed);
  }

  return { ok: true, value: result };
};

const normalizeMaxParagraphs = (value: unknown): Result<number, string> => {
  if (value === undefined) {
    return { ok: true, value: defaultStyleHints.maxParagraphs };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "must be a number" };
  }

  if (!Number.isInteger(value)) {
    return { ok: false, error: "must be an integer" };
  }

  if (value < 1 || value > 6) {
    return { ok: false, error: "must be between 1 and 6" };
  }

  return { ok: true, value };
};

export const parseUserModelInput = (input: unknown): Result<UserModelV1, UserModelParseError> => {
  if (!isRecord(input)) {
    return { ok: false, error: { type: "INVALID_MODEL", message: "model must be an object" } };
  }

  const intentRaw = input.intent;
  const intent =
    intentRaw === undefined
      ? defaultUserModel.intent
      : typeof intentRaw === "string"
        ? intentRaw.trim()
        : null;

  if (intent === null) {
    return { ok: false, error: { type: "INVALID_MODEL", message: "intent must be a string" } };
  }

  if (intent.length > 500) {
    return { ok: false, error: { type: "INVALID_MODEL", message: "intent must be at most 500 characters" } };
  }

  const styleHintsRaw = input.styleHints;
  const styleHintsObject = styleHintsRaw === undefined ? {} : styleHintsRaw;
  if (!isRecord(styleHintsObject)) {
    return { ok: false, error: { type: "INVALID_MODEL", message: "styleHints must be an object" } };
  }

  const opening = normalizeStringArray(styleHintsObject.openingPhrases, { maxItems: 5, maxLength: 200 });
  if (!opening.ok) {
    return { ok: false, error: { type: "INVALID_MODEL", message: `styleHints.openingPhrases ${opening.error}` } };
  }

  const closing = normalizeStringArray(styleHintsObject.closingPhrases, { maxItems: 5, maxLength: 200 });
  if (!closing.ok) {
    return { ok: false, error: { type: "INVALID_MODEL", message: `styleHints.closingPhrases ${closing.error}` } };
  }

  const maxParagraphs = normalizeMaxParagraphs(styleHintsObject.maxParagraphs);
  if (!maxParagraphs.ok) {
    return { ok: false, error: { type: "INVALID_MODEL", message: `styleHints.maxParagraphs ${maxParagraphs.error}` } };
  }

  const preferencesRaw = input.preferences;
  const preferencesObject = preferencesRaw === undefined ? {} : preferencesRaw;
  if (!isRecord(preferencesObject)) {
    return { ok: false, error: { type: "INVALID_MODEL", message: "preferences must be an object" } };
  }

  const avoidRaw = preferencesObject.avoidCopyingFromFragments;
  const avoidCopyingFromFragments =
    avoidRaw === undefined
      ? defaultUserModel.preferences.avoidCopyingFromFragments
      : typeof avoidRaw === "boolean"
        ? avoidRaw
        : null;

  if (avoidCopyingFromFragments === null) {
    return {
      ok: false,
      error: { type: "INVALID_MODEL", message: "preferences.avoidCopyingFromFragments must be a boolean" },
    };
  }

  return {
    ok: true,
    value: {
      version: 1,
      intent,
      styleHints: {
        openingPhrases: opening.value.length > 0 ? opening.value : defaultStyleHints.openingPhrases,
        closingPhrases: closing.value.length > 0 ? closing.value : defaultStyleHints.closingPhrases,
        maxParagraphs: maxParagraphs.value,
      },
      preferences: {
        avoidCopyingFromFragments,
      },
    },
  };
};

export const parseUserModelJson = (json: string | null | undefined): Result<UserModelV1, UserModelParseError> => {
  const trimmed = (json ?? "").trim();
  if (trimmed.length === 0 || trimmed === "{}") {
    return { ok: true, value: defaultUserModel };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (error) {
    return {
      ok: false,
      error: {
        type: "INVALID_JSON",
        message: error instanceof Error ? error.message : "Invalid JSON",
      },
    };
  }

  return parseUserModelInput(parsed);
};

export const serializeUserModelJson = (model: UserModelV1): string => JSON.stringify(model);

