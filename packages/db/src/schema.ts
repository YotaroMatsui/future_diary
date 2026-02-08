export const diaryStatusValues = ["draft", "confirmed"] as const;
export type DiaryStatus = (typeof diaryStatusValues)[number];

export const diaryEntryRevisionKindValues = ["generated", "saved", "confirmed"] as const;
export type DiaryEntryRevisionKind = (typeof diaryEntryRevisionKindValues)[number];

export interface DiaryRow {
  id: string;
  user_id: string;
  date: string;
  status: DiaryStatus;
  generated_text: string;
  final_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiaryEntryRevisionRow {
  id: string;
  entry_id: string;
  kind: DiaryEntryRevisionKind;
  body: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  timezone: string;
  preferences_json: string;
  created_at: string;
  updated_at: string;
}

export interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_used_at: string;
}
