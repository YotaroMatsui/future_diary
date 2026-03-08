import type { UserModel } from "./api";

export type ReflectionSourceEntry = {
  date: string;
  body: string;
};

export type ReflectionInsight = {
  sampleSize: number;
  averageCharacters: number;
  topKeywords: readonly string[];
  diaryPurpose: string;
  diaryStyle: string;
  practiceKnowledge: string;
};

const stopwords = new Set([
  "今日",
  "明日",
  "昨日",
  "自分",
  "こと",
  "これ",
  "それ",
  "ため",
  "よう",
  "ところ",
  "感じ",
  "思う",
  "する",
  "した",
  "できる",
]);

const isHiraganaOnly = (value: string): boolean => /^[\u3041-\u309F]+$/.test(value);

const normalizeText = (text: string): string => text.trim().replace(/\s+/g, " ");

const extractTokens = (text: string): string[] => {
  const normalized = normalizeText(text);
  if (normalized.length === 0) {
    return [];
  }

  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter("ja", { granularity: "word" })
      : null;

  const tokens: string[] = [];

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

      tokens.push(token);
    }

    return tokens;
  }

  for (const token of normalized.split(/\s+/)) {
    const cleaned = token.trim();
    if (cleaned.length < 2 || cleaned.length > 24) {
      continue;
    }
    if (stopwords.has(cleaned)) {
      continue;
    }
    tokens.push(cleaned);
  }

  return tokens;
};

const average = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
};

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

const countSignal = (tokens: readonly string[], terms: readonly string[]): number =>
  tokens.reduce((sum, token) => {
    const matched = terms.some((term) => token.includes(term));
    return matched ? sum + 1 : sum;
  }, 0);

const toTopKeywords = (tokens: readonly string[], max: number): string[] => {
  const frequency = new Map<string, number>();

  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  return [...frequency.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0], "ja");
    })
    .slice(0, Math.max(0, max))
    .map(([token]) => token);
};

const summarizePurpose = (input: {
  actionSignal: number;
  reflectionSignal: number;
  topKeywords: readonly string[];
}): string => {
  const keywordSnippet = input.topKeywords.slice(0, 3).join("・");

  const base =
    input.actionSignal > input.reflectionSignal * 1.2
      ? "予実を確認しながら行動を前進させるための日記"
      : input.reflectionSignal > input.actionSignal * 1.2
        ? "出来事と気づきを振り返り、次に活かすための日記"
        : "日々の出来事と気づきを記録し、明日の行動につなげるための日記";

  if (keywordSnippet.length === 0) {
    return `${base}。`;
  }

  return `${base}。中心テーマ: ${keywordSnippet}。`;
};

export const analyzeReflection = (entries: readonly ReflectionSourceEntry[]): ReflectionInsight => {
  const validEntries = entries
    .map((entry) => ({
      date: entry.date,
      body: entry.body.trim(),
    }))
    .filter((entry) => entry.body.length > 0);

  if (validEntries.length === 0) {
    return {
      sampleSize: 0,
      averageCharacters: 0,
      topKeywords: [],
      diaryPurpose: "日記が蓄積されると、目的のたたき台を自動で提案します。",
      diaryStyle: "本文が蓄積されると、筆致の傾向を自動で提案します。",
      practiceKnowledge: "日々の実践から得られたナレッジは、日記の蓄積後に自動抽出されます。",
    };
  }

  const bodies = validEntries.map((entry) => entry.body);
  const normalizedBodies = bodies.map(normalizeText);
  const allTokens = normalizedBodies.flatMap(extractTokens);
  const topKeywords = toTopKeywords(allTokens, 8);

  const averageCharacters = average(bodies.map((body) => body.length));
  const paragraphCounts = bodies.map((body) => body.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0).length);
  const averageParagraphs = average(paragraphCounts);

  const sentences = normalizedBodies
    .flatMap((body) => body.split(/[。.!?！？]+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const averageSentenceCharacters = average(sentences.map((sentence) => sentence.length));

  const politeCount = normalizedBodies.reduce(
    (sum, body) => sum + countMatches(body, /(です|ます|でした|ました|ません|でしょう)/g),
    0,
  );
  const plainCount = normalizedBodies.reduce((sum, body) => sum + countMatches(body, /(だ。|である|だった|する。|した。)/g), 0);

  const reflectionSignal = countSignal(allTokens, ["振り返", "気づ", "内省", "見直", "観察", "意味"]);
  const actionSignal = countSignal(allTokens, ["進め", "実行", "開始", "完了", "取り組", "達成", "計画", "管理"]);

  const tone =
    politeCount > plainCount * 1.2
      ? "丁寧体寄り"
      : plainCount > politeCount * 1.2
        ? "常体寄り"
        : "丁寧体と常体の混在";

  const rhythm =
    averageSentenceCharacters < 24
      ? "短文テンポ"
      : averageSentenceCharacters < 44
        ? "中くらいの文長"
        : "長文で掘り下げる文長";

  const diaryStyle = `${tone}、${rhythm}。平均 ${averageParagraphs.toFixed(1)} 段落 / ${Math.round(averageCharacters)} 文字。`;

  const categoryScores = [
    {
      score: countSignal(allTokens, ["整え", "継続", "習慣", "管理", "計画", "優先", "確認"]),
      label: "計画と実行の精度を上げる知見が蓄積されています",
    },
    {
      score: countSignal(allTokens, ["学び", "改善", "挑戦", "試行", "更新", "検証"]),
      label: "改善サイクルを回す知見が蓄積されています",
    },
    {
      score: countSignal(allTokens, ["家族", "友人", "同僚", "会話", "対話", "感謝", "相談"]),
      label: "対話や関係性に関する知見が蓄積されています",
    },
    {
      score: countSignal(allTokens, ["睡眠", "休息", "散歩", "運動", "体調", "食事", "呼吸"]),
      label: "体調管理とコンディション設計の知見が蓄積されています",
    },
  ] as const;

  const bestCategory = [...categoryScores].sort((left, right) => right.score - left.score)[0];
  const keywordSnippet = topKeywords.slice(0, 4).join("・");
  const practiceDirection =
    reflectionSignal > actionSignal
      ? "振り返りを次の具体行動に1つ変換すると再現性が上がります。"
      : "実行結果を1行で振り返ると改善ポイントが定着します。";

  const practiceKnowledge =
    (bestCategory && bestCategory.score > 0
      ? `${bestCategory.label}。`
      : "出来事と内省の往復から実践知が蓄積されています。") +
    (keywordSnippet.length > 0 ? ` 主要キーワード: ${keywordSnippet}。` : " ") +
    ` ${practiceDirection}`;

  return {
    sampleSize: validEntries.length,
    averageCharacters,
    topKeywords,
    diaryPurpose: summarizePurpose({ actionSignal, reflectionSignal, topKeywords }),
    diaryStyle,
    practiceKnowledge,
  };
};

const fillWhenEmpty = (current: string, fallback: string): string => (current.trim().length > 0 ? current : fallback);

export const mergeInsightIntoUserModel = (model: UserModel, insight: ReflectionInsight): UserModel => ({
  ...model,
  intent: fillWhenEmpty(model.intent, insight.diaryPurpose),
  reflection: {
    ...model.reflection,
    diaryCharacterization: fillWhenEmpty(model.reflection.diaryCharacterization, insight.diaryStyle),
    writingStyle: fillWhenEmpty(model.reflection.writingStyle, insight.diaryStyle),
    // Extracted from diary corpus; UI treats this as read-only.
    inferredProfile: insight.practiceKnowledge,
  },
});
