# apps/web

`apps/web/src/App.tsx` は 未来日記の下書き生成（当日初回の自動生成）/編集/保存/確定/履歴閲覧 UI を提供し、`apps/api` の HTTP API と疎結合に通信する。通信境界は `apps/web/src/api.ts`、スタイルは `apps/web/src/app.css` に集約する。

- パス: `apps/web/README.md`
- 状態: Implemented
- 種別（Profile）: src-module
- 関連:
  - See: `apps/api/README.md`
  - See: `packages/ui/README.md`
- 注意:
  - accessToken/timezone は localStorage に保存する（accessToken は秘密情報）。

<details>
<summary>目次</summary>

- [役割](#役割)
- [スコープ](#スコープ)
- [ローカル開発](#ローカル開発)
- [ディレクトリ構成](#ディレクトリ構成)
- [公開インタフェース](#公開インタフェース)
- [契約と検証](#契約と検証)
- [設計ノート](#設計ノート)
- [品質](#品質)
- [内部](#内部)

</details>

## 役割

- Vite/React の SPA エントリを提供。
- 当日初回の「未来日記（下書き）」を生成して編集できる UI を提供。
- 保存/確定/履歴閲覧を API 経由で操作する。

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/web/src/main.tsx:12` — React root mount。
- [E2] `apps/web/src/App.tsx:481` — 当日初回の draft auto load。
- [E3] `apps/web/src/App.tsx:214` — draft API call。
- [E4] `apps/web/src/App.tsx:259` — save API call。
- [E5] `apps/web/src/App.tsx:287` — confirm API call。
- [E6] `apps/web/src/App.tsx:188` — history list API call。
</details>

## スコープ

- 対象（In scope）:
  - 未来日記（下書き）の生成/編集/保存/確定 UI
  - 履歴閲覧 UI
  - API base URL 切替
- 対象外（Non-goals）:
  - 外部IdP連携やフル機能認証（MVPは accessToken で識別）
  - リッチテキスト編集
- 委譲（See）:
  - See: `apps/api/README.md`
- 互換性:
  - N/A
- 依存方向:
  - 許可:
    - web -> api HTTP
  - 禁止:
    - web -> api source import

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/web/src/App.tsx:634` — draft 操作 UI。
- [E2] `apps/web/src/App.tsx:703` — editor UI。
- [E3] `apps/web/src/App.tsx:735` — history UI。
- [E4] `apps/web/src/api.ts:140` — draft client。
</details>

## ローカル開発

- 依存インストール: `make install`
- 環境変数: `cp apps/web/.env.example apps/web/.env.local`
- 起動: `make dev-web`
- 確認: `open http://127.0.0.1:5173`

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/web/package.json:6` — `vite dev`。
- [E2] `apps/web/.env.example:1` — API base URL。
</details>

## ディレクトリ構成

```text
.
└── apps/web/
    ├── e2e-smoke.test.ts         # E2E smoke（web -> api -> d1）
    ├── src/                     # UI実装 / See: src/README.md
    ├── vite.config.ts           # Vite config
    ├── index.html               # HTML entry
    └── README.md                # この文書
```

## 公開インタフェース

### 提供するもの / 提供しないもの

- 提供:
  - 未来日記（下書き）の生成/編集/保存/確定 UI
  - 履歴閲覧 UI
- 非提供:
  - 外部IdP連携などのフル機能認証 UI

### エントリポイント / エクスポート（SSOT）

| 公開シンボル  | 種別      | 定義元        | 目的           | 根拠                     |
| ------------- | --------- | ------------- | -------------- | ------------------------ |
| `App`                 | component | `src/App.tsx` | UI root | `apps/web/src/App.tsx:85` |
| `fetchFutureDiaryDraft` | function  | `src/api.ts`  | draft 取得/生成 | `apps/web/src/api.ts:140` |
| `createAuthSession`     | function  | `src/api.ts`  | session 作成 | `apps/web/src/api.ts:155` |
| `fetchAuthMe`           | function  | `src/api.ts`  | session 検証 | `apps/web/src/api.ts:166` |
| `logout`                | function  | `src/api.ts`  | session 破棄 | `apps/web/src/api.ts:169` |
| `saveDiaryEntry`        | function  | `src/api.ts`  | diary 保存 | `apps/web/src/api.ts:187` |
| `confirmDiaryEntry`     | function  | `src/api.ts`  | diary 確定 | `apps/web/src/api.ts:196` |
| `listDiaryEntries`      | function  | `src/api.ts`  | 履歴取得 | `apps/web/src/api.ts:208` |
| `deleteDiaryEntry`      | function  | `src/api.ts`  | diary 削除 | `apps/web/src/api.ts:219` |
| `deleteUser`            | function  | `src/api.ts`  | user 削除 | `apps/web/src/api.ts:222` |

### 使い方（必須）

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787 make dev-web
```

### 依存ルール

- 許可する import:
  - `react`, `react-dom`
  - local client helper
- 禁止する import:
  - `apps/api/src/*`

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/web/src/App.tsx:1`
- [E2] `apps/web/src/App.tsx:2`
</details>

## 契約と検証

### 契約 SSOT

- API response 型:
  - `FutureDiaryDraftResponse`
  - `AuthSessionCreateResponse`
  - `AuthMeResponse`
  - `DiaryEntrySaveResponse`
  - `DiaryEntryConfirmResponse`
  - `DiaryEntriesListResponse`
  - `DiaryEntryDeleteResponse`
- `.env` の `VITE_API_BASE_URL`。

### 検証入口（CI / ローカル）

- [E1] `bun --cwd apps/web run typecheck`
- [E2] `bun --cwd apps/web run build`
- [E3] `bun --cwd apps/web run smoke`

### テスト（根拠として使う場合）

| テストファイル | コマンド                       | 検証内容       | 主要 assertion | 根拠                      |
| -------------- | ------------------------------ | -------------- | -------------- | ------------------------- |
| `apps/web/e2e-smoke.test.ts` | `bun --cwd apps/web run smoke` | E2E smoke（web -> api -> d1） | draft/save/confirm/list が成功 | `apps/web/e2e-smoke.test.ts:1` |
| N/A            | `bun --cwd apps/web run build` | UI bundle 成立 | build success  | `apps/web/package.json:9` |

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/web/src/api.ts:1`
- [E2] `apps/web/.env.example:1`
- [E3] `apps/web/package.json:7` — smoke script。
- [E4] `apps/web/e2e-smoke.test.ts:1` — smoke flow（draft/save/confirm/list）。
</details>

## 設計ノート

- データ形状:
  - draft:
    - auth: `Authorization: Bearer <accessToken>`
    - request: `{ date, timezone }`
    - response: `{ ok, draft, meta }`
  - save:
    - request: `{ date, body }`
  - confirm:
    - request: `{ date }`
  - delete:
    - request: `{ date }`
  - list:
    - request: `{ onOrBeforeDate, limit }`
- 失敗セマンティクス:
  - fetch失敗時に toast を error 表示（status + API payload 整形）。
- メインフロー:
  - (accessToken/timezone が揃っていれば) mount -> 当日 draft 生成 -> editor 表示。
  - edit -> save -> confirm。
  - list -> history 表示。
- I/O 境界:
  - browser fetch（`api.ts`）。
  - localStorage（accessToken/timezone）。
- トレードオフ:
  - accessToken を localStorage に保持する（XSS リスクは残る）。

```mermaid
flowchart TD
  UI["apps/web/src/App.tsx"] -->|"call"| CL["apps/web/src/api.ts"]
  CL -->|"boundary(I/O)"| DRAFT["POST /v1/future-diary/draft"]
  CL -->|"boundary(I/O)"| SAVE["POST /v1/diary/entry/save"]
  CL -->|"boundary(I/O)"| CONF["POST /v1/diary/entry/confirm"]
  CL -->|"boundary(I/O)"| LIST["POST /v1/diary/entries/list"]
```

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/web/src/App.tsx:481` — mount時の自動生成。
- [E2] `apps/web/src/api.ts:65` — JSON POST boundary。
- [E3] `apps/web/src/api.ts:140` — draft client。
- [E4] `apps/web/src/api.ts:187` — save client。
- [E5] `apps/web/src/api.ts:196` — confirm client。
- [E6] `apps/web/src/api.ts:208` — list client。
</details>

## 品質

- テスト戦略:
  - build/typecheck を SSOT とし、統合の退行検知は `make smoke`（`apps/web/e2e-smoke.test.ts`）で web API client -> api -> SQLite(D1 schema) の最小フローを検証する。
- 主なリスクと対策（3〜7）:

| リスク            | 対策（検証入口）          | 根拠                      |
| ----------------- | ------------------------- | ------------------------- |
| API未起動/到達不能 | 例外を toast へ表示 | `apps/web/src/App.tsx:195` |
| timezone 入力不正 | Intl 例外を握り潰して local date へfallback | `apps/web/src/App.tsx:43` |
| 操作ミスで未保存が残る | unsaved/saved をUIに表示 | `apps/web/src/App.tsx:699` |

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/web/src/api.ts:84` — 非200で例外化。
- [E2] `apps/web/src/App.tsx:195` — 例外を toast 表示。
- [E3] `Makefile:50` — `make smoke` target。
- [E4] `apps/web/e2e-smoke.test.ts:1` — E2E smoke。
</details>

## 内部

<details>
<summary>品質（関数型プログラミング観点） / OPEN / ISSUE / SUMMARY</summary>

### 品質（関数型プログラミング観点）

| 項目         | 判定 | 理由                          | 根拠                      |
| ------------ | ---- | ----------------------------- | ------------------------- |
| 副作用の隔離 | YES  | fetch/localStorage を境界へ分離 | `apps/web/src/api.ts:65` |
| 不変性       | YES  | state更新は新値セットのみ     | `apps/web/src/App.tsx:707` |
| 例外より型   | NO   | 非200を例外として扱う         | `apps/web/src/api.ts:84`  |

### [OPEN]

- なし。

### [ISSUE]

- なし。

### [SUMMARY]

- Web は 未来日記（下書き）の生成/編集/保存/確定/履歴閲覧 の UI を提供する。

</details>
