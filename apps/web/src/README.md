# apps/web/src

`apps/web/src` は Future Diary のフロント実装を保持する。現在は `App.tsx` を薄い composition root とし、認証・日記編集の状態管理を `use-future-diary-app.ts`、画面責務を `*-page.tsx` / `*-pane.tsx` / `app-header.tsx` へ分割している。`api.ts` は HTTP 境界、`ui-*.tsx` は shadcn ベースのUIプリミティブを提供する。

- パス: `apps/web/src/README.md`
- 状態: Implemented
- 種別（Profile）: src-module
- 関連:
  - See: `../README.md`

## 役割

- `main.tsx`: React root mount。
- `App.tsx`: 画面 composition root（`AppHeader` + Login/Diary page の切り替え）。
- `use-future-diary-app.ts`: hashルーティング、OAuth/セッション復元、下書き生成ポーリング、auto-save、再生成の状態遷移管理。
- `diary-page.tsx` / `login-page.tsx`: ページ単位の表示責務。
- `diary-editor-pane.tsx` / `diary-calendar-pane.tsx` / `app-header.tsx`: 共通UIブロック。
- `future-diary-date.ts` / `future-diary-browser.ts` / `future-diary-types.ts`: 純粋関数・境界ユーティリティ・型定義。
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
    ├── App.tsx                      # composition root
    ├── app-header.tsx               # login/logout header
    ├── diary-page.tsx               # diary page container
    ├── diary-editor-pane.tsx        # editor pane
    ├── diary-calendar-pane.tsx      # calendar pane
    ├── login-page.tsx               # login page
    ├── use-future-diary-app.ts      # app state + use cases
    ├── future-diary-date.ts         # date/month/calendar utilities
    ├── future-diary-browser.ts      # location/localStorage utilities
    ├── future-diary-types.ts        # app/domain types
    ├── api.ts                       # HTTP client + response types
    ├── index.css                    # tailwind/shadcn design tokens
    ├── main.tsx                     # React entrypoint
    ├── ui-badge.tsx                 # Badge primitive
    ├── ui-button.tsx                # Button primitive
    ├── ui-card.tsx                  # Card primitives
    ├── ui-input.tsx                 # Input primitive
    ├── ui-separator.tsx             # Separator primitive
    ├── ui-textarea.tsx              # Textarea primitive
    ├── utils.ts                     # class merge helper
    └── README.md                    # この文書
```

## 契約と検証

- `bun run --cwd apps/web lint`
- `bun run --cwd apps/web typecheck`
- `bun run --cwd apps/web build`
- `bun run --cwd apps/web smoke`

## 設計ノート

- `use-future-diary-app.ts` は副作用を境界に集約し、view components は props のみを受け取る。
- `loadDraft` が日付単位で draft 取得/生成を実行し、未保存編集中は poll 更新で本文上書きを避ける。
- `blurEditor` が textarea blur 時に `persistDraft` を呼び出して自動保存する。
- `startTypewriter` が生成完了直後の本文を1文字ずつ表示する。
- `loadMonthFilledState` が `listDiaryEntries` を使って当月の記入済み日付を算出し、カレンダーに反映する。
- 再生成UIは本文エリア右上の wand-sparkles アイコンのみ。
