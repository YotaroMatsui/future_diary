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
    "- 過去断片は『文体/傾向のヒント』または『連想の材料』であり、文章の引用・要約・焼き直しをしない。",
    "- 固有名詞・具体的な出来事は断定しない（必要なら『〜かもしれない』などで曖昧にする）。",
    "- 文体は与えられたヒント（意図・スタイル）に寄せる。",
    "- できるだけユーザが編集しやすい分量に抑える（数段落）。",
    "- 本文は段落ごとに空行で区切る。",
    "- 過度にネガティブな反すうを増幅しない。",
  ].join("\n");

export const buildFutureDiaryDraftLlmUserPrompt = (input: GenerateFutureDiaryInput): string => {
  const normalizeLine = (line: string): string => line.trim().replace(/\s+/g, " ");

  const toKeywordSnippet = (text: string): string => {
    const normalized = normalizeLine(text);
    if (normalized.length === 0) {
      return "(none)";
    }

    const segmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter("ja", { granularity: "word" })
        : null;

    const stopwords = new Set([
      "今日",
      "明日",
      "昨日",
      "今",
      "自分",
      "感じ",
      "気持ち",
      "こと",
      "ところ",
    ]);

    const isHiraganaOnly = (value: string): boolean => /^[\u3041-\u309F]+$/.test(value);

    const keywords: string[] = [];

    if (segmenter) {
      for (const part of segmenter.segment(normalized) as Iterable<{ segment: string; isWordLike?: boolean }>) {
        if (!part.isWordLike) {
          continue;
        }
        const token = part.segment.trim();
        if (token.length < 2 || token.length > 24) {
          continue;
        }
        if (stopwords.has(token)) {
          continue;
        }
        if (isHiraganaOnly(token)) {
          continue;
        }
        keywords.push(token);
        if (keywords.length >= 10) {
          break;
        }
      }
    }

    const uniq = [...new Set(keywords)];
    return uniq.length > 0 ? uniq.join(" / ") : "(none)";
  };

  const fragmentsText = input.recentFragments
    .map((fragment) => `- id=${fragment.id} date=${fragment.date} relevance=${fragment.relevance}\n  keywords: ${toKeywordSnippet(fragment.text)}`)
    .join("\n");

  const openingCandidates = input.styleHints.openingPhrases.map((p) => `- ${p}`).join("\n");
  const closingCandidates = input.styleHints.closingPhrases.map((p) => `- ${p}`).join("\n");
  const intent = normalizeLine(input.draftIntent);

  return [
    "次の情報をもとに、未来日記（下書き）の本文を生成してください。",
    "",
    `日付: ${input.date}`,
    `タイムゾーン: ${input.userTimezone}`,
    "",
    "ユーザーの意図:",
    intent.length > 0 ? intent : "- (none)",
    "",
    "スタイルヒント:",
    `- maxParagraphs: ${input.styleHints.maxParagraphs}`,
    "- openingPhrases:",
    openingCandidates.length > 0 ? openingCandidates : "- (none)",
    "- closingPhrases:",
    closingCandidates.length > 0 ? closingCandidates : "- (none)",
    "",
    "生成プリファレンス:",
    `- avoidCopyingFromFragments: ${input.preferences.avoidCopyingFromFragments ? "true" : "false"}`,
    "",
    "参照断片（過去の書記のキーワード。文章は引用しない）:",
    fragmentsText.length > 0 ? fragmentsText : "- (none)",
    "",
    "注意:",
    "- 断定せず、『〜したい』『〜かもしれない』などのモードで書く。",
    "- openingPhrases / closingPhrases が与えられている場合は、自然な形で文頭/文末に寄せる。",
    "- 参照断片の文章をそのまま出力しない（コピー/要約/焼き直しを避ける）。",
  ].join("\n");
};
