export const diaryStatusValues = ["draft", "confirmed"] as const;
export type DiaryStatus = (typeof diaryStatusValues)[number];

export const draftGenerationStatusValues = ["created", "processing", "failed", "completed"] as const;
export type DraftGenerationStatus = (typeof draftGenerationStatusValues)[number];
export const diaryEntryRevisionKindValues = ["generated", "saved", "confirmed"] as const;
export type DiaryEntryRevisionKind = (typeof diaryEntryRevisionKindValues)[number];

export const generationSourceValues = ["llm", "deterministic", "fallback"] as const;
export type GenerationSource = (typeof generationSourceValues)[number];

export interface DiaryRow {
  id: string;
  user_id: string;
  date: string;
  status: DiaryStatus;
  generation_status: DraftGenerationStatus;
  generation_error: string | null;
  generation_source: GenerationSource | null;
  generation_user_model_json: string | null;
  generation_source_fragment_ids_json: string;
  generation_keywords_json: string;
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
  session_kind: "legacy" | "google";
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string;
}

export interface UserIdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  email: string | null;
  email_verified: number;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string;
}

export interface AuthOauthStateRow {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}
