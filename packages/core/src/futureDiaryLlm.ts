import type { GenerateFutureDiaryInput } from "./types";

export type FutureDiaryDraftBody = {
  body: string;
};

export const futureDiaryDraftBodyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    body: {
      type: "string",
      description:
        "Japanese future diary draft body. Use paragraphs separated by blank lines (two newlines).",
    },
  },
  required: ["body"],
} as const;

export const buildFutureDiaryDraftLlmSystemPrompt = (): string =>
  [
    "あなたは『未来日記（下書き）』を生成するアシスタントです。",
    "",
    "制約:",
    "- 日本語で書く。",
    "- これは『下書き』であり、断定しない（外部事実の断定、天気・ニュース等の断定をしない）。",
    "- 文体は与えられた過去断片の雰囲気に寄せる。",
    "- できるだけユーザが編集しやすい分量に抑える（数段落）。",
    "- 本文は段落ごとに空行で区切る。",
    "- 過度にネガティブな反すうを増幅しない。",
  ].join("\n");

export const buildFutureDiaryDraftLlmUserPrompt = (input: GenerateFutureDiaryInput): string => {
  const fragmentsText = input.recentFragments
    .map(
      (fragment) =>
        `- id=${fragment.id} date=${fragment.date} relevance=${fragment.relevance}\n  ${fragment.text}`,
    )
    .join("\n");

  const openingCandidates = input.styleHints.openingPhrases.map((p) => `- ${p}`).join("\n");
  const closingCandidates = input.styleHints.closingPhrases.map((p) => `- ${p}`).join("\n");

  return [
    "次の情報をもとに、未来日記（下書き）の本文を生成してください。",
    "",
    `日付: ${input.date}`,
    `タイムゾーン: ${input.userTimezone}`,
    "",
    "スタイルヒント:",
    `- maxParagraphs: ${input.styleHints.maxParagraphs}`,
    "- openingPhrases:",
    openingCandidates.length > 0 ? openingCandidates : "- (none)",
    "- closingPhrases:",
    closingCandidates.length > 0 ? closingCandidates : "- (none)",
    "",
    "参照断片（過去の書記）:",
    fragmentsText.length > 0 ? fragmentsText : "- (none)",
    "",
    "注意:",
    "- 断定せず、『〜したい』『〜かもしれない』などのモードで書く。",
    "- openingPhrases / closingPhrases が与えられている場合は、自然な形で文頭/文末に寄せる。",
  ].join("\n");
};

