import type { Result, StyleHints } from "./types";

export type UserReflectionV1 = {
  diaryCharacterization: string;
  writingStyle: string;
  inferredProfile: string;
  idealSelfImage: string;
  realityPlan: string;
};

export type UserModelV1 = {
  version: 1;
  intent: string;
  styleHints: StyleHints;
  preferences: {
    avoidCopyingFromFragments: boolean;
  };
  reflection: UserReflectionV1;
};

export type UserModelParseError =
  | { type: "INVALID_JSON"; message: string }
  | { type: "INVALID_MODEL"; message: string };

export const defaultStyleHints: StyleHints = {
  openingPhrases: ["今日は落ち着いて一日を振り返る。"],
  closingPhrases: ["最後に、明日の最初の一歩を一つ決める。"],
  maxParagraphs: 2,
} as const;

export const defaultUserReflection: UserReflectionV1 = {
  diaryCharacterization: "短い振り返りメモ。",
  writingStyle: "短い文で、事実・気づき・次の一歩の順に書く。",
  inferredProfile: "",
  idealSelfImage: "",
  realityPlan: "",
};

export const defaultUserModel: UserModelV1 = {
  version: 1,
  intent: "今日の出来事を短く振り返り、明日の一歩を決める。",
  styleHints: defaultStyleHints,
  preferences: {
    avoidCopyingFromFragments: true,
  },
  reflection: defaultUserReflection,
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

const normalizeTextField = (value: unknown, opts: { defaultValue: string; maxLength: number }): Result<string, string> => {
  if (value === undefined) {
    return { ok: true, value: opts.defaultValue };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "must be a string" };
  }

  const trimmed = value.trim();
  if (trimmed.length > opts.maxLength) {
    return { ok: false, error: `must be at most ${opts.maxLength} characters` };
  }

  return { ok: true, value: trimmed };
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

  const reflectionRaw = input.reflection;
  const reflectionObject = reflectionRaw === undefined ? {} : reflectionRaw;
  if (!isRecord(reflectionObject)) {
    return { ok: false, error: { type: "INVALID_MODEL", message: "reflection must be an object" } };
  }

  const diaryCharacterization = normalizeTextField(reflectionObject.diaryCharacterization, {
    defaultValue: defaultUserReflection.diaryCharacterization,
    maxLength: 1200,
  });
  if (!diaryCharacterization.ok) {
    return {
      ok: false,
      error: { type: "INVALID_MODEL", message: `reflection.diaryCharacterization ${diaryCharacterization.error}` },
    };
  }

  const writingStyle = normalizeTextField(reflectionObject.writingStyle, {
    defaultValue: defaultUserReflection.writingStyle,
    maxLength: 1200,
  });
  if (!writingStyle.ok) {
    return {
      ok: false,
      error: { type: "INVALID_MODEL", message: `reflection.writingStyle ${writingStyle.error}` },
    };
  }

  const inferredProfile = normalizeTextField(reflectionObject.inferredProfile, {
    defaultValue: defaultUserReflection.inferredProfile,
    maxLength: 1200,
  });
  if (!inferredProfile.ok) {
    return {
      ok: false,
      error: { type: "INVALID_MODEL", message: `reflection.inferredProfile ${inferredProfile.error}` },
    };
  }

  const idealSelfImage = normalizeTextField(reflectionObject.idealSelfImage, {
    defaultValue: defaultUserReflection.idealSelfImage,
    maxLength: 1200,
  });
  if (!idealSelfImage.ok) {
    return {
      ok: false,
      error: { type: "INVALID_MODEL", message: `reflection.idealSelfImage ${idealSelfImage.error}` },
    };
  }

  const realityPlan = normalizeTextField(reflectionObject.realityPlan, {
    defaultValue: defaultUserReflection.realityPlan,
    maxLength: 1200,
  });
  if (!realityPlan.ok) {
    return {
      ok: false,
      error: { type: "INVALID_MODEL", message: `reflection.realityPlan ${realityPlan.error}` },
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
      reflection: {
        diaryCharacterization: diaryCharacterization.value,
        writingStyle: writingStyle.value,
        inferredProfile: inferredProfile.value,
        idealSelfImage: idealSelfImage.value,
        realityPlan: realityPlan.value,
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

const normalizeLine = (line: string): string => line.trim().replace(/\s+/g, " ");
const truncate = (text: string, maxLength: number): string => (text.length <= maxLength ? text : text.slice(0, maxLength));

const toNonEmptyLines = (lines: readonly string[]): string[] =>
  lines.map((line) => normalizeLine(line)).filter((line) => line.length > 0);

export const buildGenerationIntentFromUserModel = (model: UserModelV1): string => {
  const segments = toNonEmptyLines([model.intent]);
  if (segments.length === 0) {
    return "";
  }

  return truncate(segments.join(" / "), 500);
};

export const buildUserModelPromptContext = (model: UserModelV1): string => {
  const diaryStyle = toNonEmptyLines([model.reflection.writingStyle, model.reflection.diaryCharacterization])[0] ?? "";
  const lines = toNonEmptyLines([
    model.intent.length > 0 ? `日記の目的: ${model.intent}` : "",
    diaryStyle.length > 0 ? `日記の特徴(筆致): ${diaryStyle}` : "",
    model.reflection.inferredProfile.length > 0 ? `日々の実践ナレッジ: ${model.reflection.inferredProfile}` : "",
  ]);

  if (lines.length === 0) {
    return "";
  }

  return truncate(lines.join("\n"), 2200);
};
