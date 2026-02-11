import type {
  FutureDiaryDraft,
  GenerateFutureDiaryError,
  GenerateFutureDiaryInput,
  Result,
  SourceFragment,
  StyleHints,
} from "./types";

const normalizeLine = (line: string): string => line.trim().replace(/\s+/g, " ");

const toKeywordList = (text: string): string[] => {
  const normalized = normalizeLine(text);
  if (normalized.length === 0) {
    return [];
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
  const isAsciiWord = (value: string): boolean => /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);

  const words: string[] = [];

  if (segmenter) {
    for (const part of segmenter.segment(normalized) as Iterable<{ segment: string; isWordLike?: boolean }>) {
      if (!part.isWordLike) {
        continue;
      }
      const token = part.segment.trim();
      if (token.length < 2) {
        continue;
      }
      if (token.length > 24) {
        continue;
      }
      if (stopwords.has(token)) {
        continue;
      }
      if (isHiraganaOnly(token)) {
        continue;
      }
      words.push(token);
    }
  } else {
    for (const token of normalized.split(/\s+/)) {
      const cleaned = token.trim();
      if (cleaned.length < 2) {
        continue;
      }
      if (cleaned.length > 24) {
        continue;
      }
      if (stopwords.has(cleaned)) {
        continue;
      }
      if (isAsciiWord(cleaned)) {
        words.push(cleaned);
      }
    }
  }

  return [...new Set(words)];
};

export const deriveKeywords = (fragments: readonly SourceFragment[], maxKeywords: number): string[] => {
  const scores = new Map<string, number>();
  const ranked = [...fragments].sort((left, right) => right.relevance - left.relevance).slice(0, 8);

  for (const fragment of ranked) {
    for (const keyword of toKeywordList(fragment.text)) {
      const prev = scores.get(keyword) ?? 0;
      scores.set(keyword, prev + Math.max(0.05, fragment.relevance));
    }
  }

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([keyword]) => keyword)
    .slice(0, Math.max(0, maxKeywords));
};

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

  const intent = normalizeLine(input.draftIntent);
  const intentParagraph = intent.length > 0 ? `今日は「${intent}」を意識して、無理なく進めたい。` : null;

  const keywordLimit = Math.min(10, Math.max(3, input.styleHints.maxParagraphs * 3));
  const keywords = deriveKeywords(input.recentFragments, keywordLimit);
  const keywordsParagraph = keywords.length > 0 ? `最近のメモから浮かぶキーワード: ${keywords.join(" / ")}` : null;

  const placeholder = "（ここに、今日の予定・やりたいこと・気づきを追記する）";

  const bodyParagraphs = [opening, intentParagraph, keywordsParagraph, placeholder, closing].filter(
    (paragraph): paragraph is string => paragraph !== null && paragraph.length > 0,
  );

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
  draftIntent: string;
}): FutureDiaryDraft => {
  const opening = input.styleHints.openingPhrases[0] ?? "今日はこんな一日になりそう。";
  const closing =
    input.styleHints.closingPhrases[0] ?? "最後に、今日の気づきを一行だけ残して終える。";

  return {
    title: `${input.date} の未来日記`,
    body: [
      opening,
      normalizeLine(input.draftIntent).length > 0 ? `今日は「${normalizeLine(input.draftIntent)}」を意識して過ごしたい。` : null,
      "（ここに、今日の予定・やりたいこと・気づきを追記する）",
      closing,
    ]
      .filter((paragraph): paragraph is string => paragraph !== null && paragraph.length > 0)
      .join("\n\n"),
    sourceFragmentIds: [],
  };
};
