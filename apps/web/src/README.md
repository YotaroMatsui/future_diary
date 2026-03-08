# apps/web/src

`apps/web/src` は Future Diary のフロント実装を保持する。現在は `App.tsx` を薄い composition root とし、認証・日記編集・振り返り（自己モデル編集）の状態管理を `use-future-diary-app.ts`、画面責務を `*-page.tsx` / `*-pane.tsx` / `app-header.tsx` へ分割している。`api.ts` は HTTP 境界、`ui-*.tsx` は shadcn ベースのUIプリミティブを提供する。

- パス: `apps/web/src/README.md`
- 状態: Implemented
- 種別（Profile）: src-module
- 関連:
  - See: `../README.md`

## 役割

- `main.tsx`: React root mount。
- `App.tsx`: 画面 composition root（`AppHeader` + Login/Diary/Reflection page の切り替え）。
- `use-future-diary-app.ts`: hashルーティング、OAuth/セッション復元、下書き生成ポーリング、auto-save、再生成、自己モデル取得/保存/分析の状態遷移管理。
- `diary-page.tsx` / `reflection-page.tsx` / `login-page.tsx`: ページ単位の表示責務。
- `diary-editor-pane.tsx` / `diary-calendar-pane.tsx` / `app-header.tsx`: 共通UIブロック。
- `future-diary-date.ts` / `future-diary-browser.ts` / `future-diary-types.ts`: 純粋関数・境界ユーティリティ・型定義。
- `api.ts`: 型付きAPIクライアント。
- `reflection-analysis.ts`: 保存済み日記をもとにした振り返り補助分析（pure）。
- `ui-*.tsx` + `utils.ts`: shadcn style の最小UIプリミティブ。
- `index.css`: Tailwind v4 + shadcn Nova tokens + 全画面共通デザインシステム（`fd-*` classes）。

## 共通デザインシステム

全画面で「必要な情報だけを表示する」ことを優先し、次のルールを共通適用する。

- 1画面1目的: 主タスク以外の情報は補助テキストへ退避し、操作導線を増やしすぎない。
- 必要最小限の視覚要素: 装飾バッジやチップは原則使わず、意味を持つ情報のみ表示する。
- 共通サーフェス: 主要コンテナは `fd-surface` を使い、境界・余白・陰影を統一する。
- 共通ページ余白: ルートコンテナは `fd-page` を使い、全画面で同一の余白/幅を維持する。
- 共通テキスト階層: フィールドラベルは `fd-field-label`、補助説明は `fd-helper-text` を使う。

実装SSOT:

- `apps/web/src/index.css` の `@layer components`（`fd-page`, `fd-surface`, `fd-field-label`, `fd-helper-text`）。

## スコープ

- 対象（In scope）:
  - Google OAuth 開始/交換、セッション復元、ログアウト
  - 日記の生成ポーリング、編集、自動保存、再生成（内部は削除API利用）
  - カレンダー選択による日付切り替え、記入済み/未記入マーカー表示
  - 振り返りページでの自己モデル編集（SSOT）と保存済み日記の軽量分析表示
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
    ├── reflection-page.tsx          # reflection page container
    ├── reflection-analysis.ts       # reflection analysis helpers
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
- `loadReflectionContext` が `user/model` と保存済み日記一覧を取得し、自己モデルの初期値（目的/筆致/実践ナレッジ）を補完する。
- 再生成UIは本文エリア右上の wand-sparkles アイコンのみ。
