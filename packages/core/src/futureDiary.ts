import type {
  FutureDiaryDraft,
  GenerateFutureDiaryError,
  GenerateFutureDiaryInput,
  Result,
  SourceFragment,
  StyleHints,
} from "./types";

const normalizeLine = (line: string): string => line.trim().replace(/\s+/g, " ");

const toParagraph = (fragment: SourceFragment): string =>
  normalizeLine(fragment.text)
    .split("。")
    .map(normalizeLine)
    .filter((chunk) => chunk.length > 0)
    .slice(0, 2)
    .join("。") + "。";

export const buildFutureDiaryDraft = (
  input: GenerateFutureDiaryInput,
): Result<FutureDiaryDraft, GenerateFutureDiaryError> => {
  if (input.styleHints.maxParagraphs <= 0) {
    return {
      ok: false,
      error: {
        type: "INVALID_STYLE_HINTS",
        message: "styleHints.maxParagraphs must be positive",
      },
    };
  }

  const rankedFragments = [...input.recentFragments]
    .filter((fragment) => normalizeLine(fragment.text).length > 0)
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, input.styleHints.maxParagraphs);

  if (rankedFragments.length === 0) {
    return {
      ok: false,
      error: {
        type: "NO_SOURCE",
        message: "No eligible source fragments were found",
      },
    };
  }

  const opening = input.styleHints.openingPhrases[0] ?? "今日はこんな一日になりそう。";
  const closing =
    input.styleHints.closingPhrases[0] ?? "最後に、今日の気づきを一行だけ残して終える。";
  const bodyParagraphs = [opening, ...rankedFragments.map(toParagraph), closing];

  return {
    ok: true,
    value: {
      title: `${input.date} の未来日記`,
      body: bodyParagraphs.join("\n\n"),
      sourceFragmentIds: rankedFragments.map((fragment) => fragment.id),
    },
  };
};

export const buildFallbackFutureDiaryDraft = (input: {
  date: string;
  styleHints: StyleHints;
}): FutureDiaryDraft => {
  const opening = input.styleHints.openingPhrases[0] ?? "今日はこんな一日になりそう。";
  const closing =
    input.styleHints.closingPhrases[0] ?? "最後に、今日の気づきを一行だけ残して終える。";

  return {
    title: `${input.date} の未来日記`,
    body: [opening, "（ここに今日の出来事を追記する）", closing].join("\n\n"),
    sourceFragmentIds: [],
  };
};
