export type DiaryStatus = "draft" | "confirmed";

export type DraftGenerationStatus = "created" | "processing" | "failed" | "completed";

export type GenerationSource = "llm" | "deterministic" | "fallback";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface SourceFragment {
  id: string;
  date: string;
  relevance: number;
  text: string;
}

export interface StyleHints {
  openingPhrases: readonly string[];
  closingPhrases: readonly string[];
  maxParagraphs: number;
}

export interface GenerationPreferences {
  avoidCopyingFromFragments: boolean;
}

export interface GenerateFutureDiaryInput {
  date: string;
  userTimezone: string;
  recentFragments: readonly SourceFragment[];
  styleHints: StyleHints;
  draftIntent: string;
  preferences: GenerationPreferences;
}

export interface FutureDiaryDraft {
  title: string;
  body: string;
  sourceFragmentIds: readonly string[];
}

export type GenerateFutureDiaryError =
  | { type: "NO_SOURCE"; message: string }
  | { type: "INVALID_STYLE_HINTS"; message: string };

export interface DiaryEntry {
  id: string;
  userId: string;
  date: string;
  status: DiaryStatus;
  generationStatus: DraftGenerationStatus;
  generationError: string | null;
  generationSource: GenerationSource | null;
  generationUserModelJson: string | null;
  generationSourceFragmentIds: readonly string[];
  generationKeywords: readonly string[];
  generatedText: string;
  finalText: string | null;
  createdAt: string;
  updatedAt: string;
}
