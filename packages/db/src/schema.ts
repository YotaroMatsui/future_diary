export const diaryStatusValues = ["draft", "confirmed"] as const;
export type DiaryStatus = (typeof diaryStatusValues)[number];

export const draftGenerationStatusValues = ["created", "processing", "failed", "completed"] as const;
export type DraftGenerationStatus = (typeof draftGenerationStatusValues)[number];

export interface DiaryRow {
  id: string;
  user_id: string;
  date: string;
  status: DiaryStatus;
  generation_status: DraftGenerationStatus;
  generation_error: string | null;
  generated_text: string;
  final_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  timezone: string;
  preferences_json: string;
  created_at: string;
  updated_at: string;
}
