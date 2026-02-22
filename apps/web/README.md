# apps/web

`apps/web` は Future Diary の Web クライアントを提供する。`apps/web/src/App.tsx` は composition root として `app-header.tsx` / `login-page.tsx` / `diary-page.tsx` を組み合わせ、`use-future-diary-app.ts` が hash route（`#/login`, `#/diary`）と認証・生成・編集の状態遷移を管理する。UIは iPhone リマインダー風の一体型レイアウトで、生成中インジケーター、typewriter表示、記入済み可視化付きカレンダーを備え、日記本文は自動保存される。

- パス: `apps/web/README.md`
- 状態: Implemented
- 種別（Profile）: src-module
- 関連:
  - See: `apps/web/src/README.md`
  - See: `apps/api/README.md`

## 役割

- ヘッダーに login/logout を集約。
- カレンダーで日付選択し、その日付の draft を取得/生成。
- 編集領域左上のインジケーターで生成中/表示中/編集中を明示。
- 本文編集は blur 時に自動保存（保存/確定ボタンなし）。
- ロジックと表示を分離し、`use-future-diary-app.ts`（状態管理）と `*-page.tsx`/`*-pane.tsx`（表示）で責務分割。

## スコープ

- 対象（In scope）:
  - Google OAuth 開始/交換、セッション復元、ログアウト
  - draft 取得/生成、本文編集、自動保存、再生成（内部は削除API利用）
  - カレンダーによる日付切り替え + 記入済み可視化 + 再取得
- 対象外（Non-goals）:
  - ローカルセッション作成
  - generated/cached等の技術メタ情報をそのまま露出するUI
  - 履歴一覧UI

## ローカル開発

- 依存インストール: `make install`
- 環境変数: `cp apps/web/.env.example apps/web/.env.local`
- 起動: `make dev-web`
- 確認: `http://127.0.0.1:5173`（競合時はViteが別ポート）

## 公開インタフェース

| 公開シンボル | 種別 | 定義元 | 目的 |
| --- | --- | --- | --- |
| `App` | component | `apps/web/src/App.tsx` | Web UI root |
| `useFutureDiaryApp` | hook | `apps/web/src/use-future-diary-app.ts` | Web app state/use case orchestration |
| `fetchFutureDiaryDraft` | function | `apps/web/src/api.ts` | 下書き取得/生成 |
| `saveDiaryEntry` | function | `apps/web/src/api.ts` | 自動保存API |
| `deleteDiaryEntry` | function | `apps/web/src/api.ts` | 日記再生成（削除後に再取得） |

## 契約と検証

- `bun run --cwd apps/web lint`
- `bun run --cwd apps/web typecheck`
- `bun run --cwd apps/web build`
- `bun run --cwd apps/web smoke`

## 設計ノート

- hash route (`#/login`, `#/diary`) で表示状態を同期。
- OAuth callback 成功時に `session` を即構築して `#/diary` へ遷移。
- Textarea の blur を契機に `saveDiaryEntry` を自動実行する。
- 生成完了時は本文を typewriter で段階表示し、ユーザー入力開始時は即停止する。
- カレンダーは `listDiaryEntries` で当月の記入済み日付を取得し、filled/unfilledマーカーを描画する。
