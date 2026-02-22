# apps/web/src

`apps/web/src` は Future Diary のフロント実装を保持する。`App.tsx` が Google認証・hashルーティング・生成インジケーター・typewriter表示・カレンダー選択・本文自動保存を管理し、`api.ts` が HTTP 境界、`ui-*.tsx` が shadcnベースのUIプリミティブを提供する。

- パス: `apps/web/src/README.md`
- 状態: Implemented
- 種別（Profile）: src-module
- 関連:
  - See: `../README.md`

## 役割

- `main.tsx`: React root mount。
- `App.tsx`: `#/login` / `#/diary` 遷移、編集UI、生成状態表示、typewriter、オートセーブ。
- `api.ts`: 型付きAPIクライアント。
- `ui-*.tsx` + `utils.ts`: shadcn style の最小UIプリミティブ。
- `index.css`: Tailwind v4 + shadcn Nova tokens。

## スコープ

- 対象（In scope）:
  - Google OAuth 開始/交換、セッション復元、ログアウト
  - 日記の生成ポーリング、編集、自動保存、再生成（内部は削除API利用）
  - カレンダー選択による日付切り替え、記入済み/未記入マーカー表示
- 対象外（Non-goals）:
  - ローカルセッション作成
  - 保存/確定ボタン
  - 履歴一覧UI、generated/cachedなど技術メタ情報の説明UI

## ディレクトリ構成

```text
.
└── apps/web/src/
    ├── App.tsx                 # 認証・編集・カレンダーの画面ロジック
    ├── api.ts                  # HTTP client + response types
    ├── index.css               # tailwind/shadcn design tokens
    ├── main.tsx                # React entrypoint
    ├── ui-badge.tsx            # Badge primitive
    ├── ui-button.tsx           # Button primitive
    ├── ui-card.tsx             # Card primitives
    ├── ui-input.tsx            # Input primitive
    ├── ui-separator.tsx        # Separator primitive
    ├── ui-textarea.tsx         # Textarea primitive
    ├── utils.ts                # class merge helper
    └── README.md               # この文書
```

## 契約と検証

- `bun run --cwd apps/web lint`
- `bun run --cwd apps/web typecheck`
- `bun run --cwd apps/web build`
- `bun run --cwd apps/web smoke`

## 設計ノート

- `loadDraft` が日付単位で draft 取得/生成を実行し、未保存編集中は poll 更新で本文上書きを避ける。
- `handleEditorBlur` が textarea blur 時に `persistDraft` を呼び出して自動保存する。
- `startTypewriter` が生成完了直後の本文を1文字ずつ表示する。
- `loadMonthFilledState` が `listDiaryEntries` を使って当月の記入済み日付を算出し、カレンダーに反映する。
- 再生成UIは本文エリア右上の wand-sparkles アイコンのみ。
