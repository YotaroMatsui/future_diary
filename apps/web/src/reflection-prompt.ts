import type { UserModel } from "./api";

export const simpleReflectionPromptDefaults = {
  intent: "今日の出来事を短く振り返り、明日の一歩を決める。",
  writingStyle: "短い文で、事実・気づき・次の一歩の順に書く。",
  openingPhrase: "今日は落ち着いて一日を振り返る。",
  closingPhrase: "最後に、明日の最初の一歩を一つ決める。",
  maxParagraphs: 2,
  avoidCopyingFromFragments: true,
} as const;

const normalizeLine = (line: string): string => line.trim().replace(/\s+/g, " ");

const firstNonEmpty = (values: readonly string[]): string =>
  values.map((value) => normalizeLine(value)).find((value) => value.length > 0) ?? "";

const toPromptContext = (model: UserModel): string => {
  const diaryStyle = firstNonEmpty([model.reflection.writingStyle, model.reflection.diaryCharacterization]);
  const lines = [
    model.intent.length > 0 ? `日記の目的: ${model.intent}` : "",
    diaryStyle.length > 0 ? `日記の特徴(筆致): ${diaryStyle}` : "",
    model.reflection.inferredProfile.length > 0 ? `日々の実践ナレッジ: ${model.reflection.inferredProfile}` : "",
  ]
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0);

  return lines.join("\n");
};

export const buildGenerationPromptPreview = (model: UserModel): string => {
  const openingCandidates = model.styleHints.openingPhrases.map((phrase) => `- ${normalizeLine(phrase)}`).join("\n");
  const closingCandidates = model.styleHints.closingPhrases.map((phrase) => `- ${normalizeLine(phrase)}`).join("\n");
  const promptContext = toPromptContext(model);
  const intent = normalizeLine(model.intent);

  return [
    "次の情報をもとに、未来日記（下書き）の本文を生成してください。",
    "",
    "日付: {{selectedDate}}",
    "タイムゾーン: {{userTimezone}}",
    "",
    "ユーザーの意図:",
    intent.length > 0 ? intent : "- (none)",
    "",
    "自己モデル（SSOT）:",
    promptContext.length > 0 ? promptContext : "- (none)",
    "",
    "スタイルヒント:",
    `- maxParagraphs: ${model.styleHints.maxParagraphs}`,
    "- openingPhrases:",
    openingCandidates.length > 0 ? openingCandidates : "- (none)",
    "- closingPhrases:",
    closingCandidates.length > 0 ? closingCandidates : "- (none)",
    "",
    "生成プリファレンス:",
    `- avoidCopyingFromFragments: ${model.preferences.avoidCopyingFromFragments ? "true" : "false"}`,
    "",
    "当日の予定（Google Calendar連携）:",
    "- {{calendar schedules}}",
    "",
    "参照断片（過去の書記のキーワード。文章は引用しない）:",
    "- {{fragment summaries}}",
  ].join("\n");
};

export const applySimpleReflectionPromptDefaults = (model: UserModel): UserModel => ({
  ...model,
  intent: simpleReflectionPromptDefaults.intent,
  styleHints: {
    ...model.styleHints,
    openingPhrases: [simpleReflectionPromptDefaults.openingPhrase],
    closingPhrases: [simpleReflectionPromptDefaults.closingPhrase],
    maxParagraphs: simpleReflectionPromptDefaults.maxParagraphs,
  },
  preferences: {
    ...model.preferences,
    avoidCopyingFromFragments: simpleReflectionPromptDefaults.avoidCopyingFromFragments,
  },
  reflection: {
    ...model.reflection,
    diaryCharacterization: simpleReflectionPromptDefaults.writingStyle,
    writingStyle: simpleReflectionPromptDefaults.writingStyle,
  },
});
