# packages/db

`packages/db/src/repository.ts` は D1 境界として `DiaryRepository` / `DiaryRevisionRepository` / `UserRepository` / `AuthSessionRepository` を提供し、`packages/core::DiaryEntry` への変換と diary/revision/user/session の read/write クエリを担当する。スキーマ契約は `src/migrations/*.sql` と `src/schema.ts` が SSOT。

- パス: `packages/db/README.md`
- 状態: Implemented
- 種別（Profile）: contract
- 関連:
  - See: `packages/core/README.md`
- 注意:
  - 現在は D1 の最小抽象のみ。

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

- D1 row <-> domain entry の変換を行う。
- `findByUserAndDate` / `listRecentByUserBeforeDate` / `listRecentByUserOnOrBeforeDate` を提供する。
- `createDraftIfMissing` / `updateFinalText` / `confirmEntry` を提供する。
- 生成の非同期化向けに `generation_status` / `generation_error` を管理し、draft の状態遷移 helper を提供する。
- `deleteByUserAndDate` / `deleteByUser` を提供する。
- `appendRevision` を提供する（生成/保存/確定のスナップショット保持）。
- `upsertUser` を提供する（`diary_entries.user_id` の FK を満たすため）。
- `findById` / `deleteUser` を提供する。
- `AuthSessionRepository` を提供する（bearer token session の read/write）。
- migration SQL で `users` / `diary_entries` / `diary_entry_revisions` / `auth_sessions` を定義する。

<details><summary>根拠（Evidence）</summary>

- [E1] `packages/db/src/repository.ts:15` — `toDiaryEntry`。
- [E2] `packages/db/src/repository.ts:60` — `DiaryRepository` interface。
- [E3] `packages/db/src/repository.ts:115` — `createDraftIfMissing`。
- [E4] `packages/db/src/repository.ts:128` — `createDraftGenerationPlaceholderIfMissing`。
- [E5] `packages/db/src/repository.ts:229` — `updateFinalText`。
- [E6] `packages/db/src/repository.ts:243` — `confirmEntry`。
- [E7] `packages/db/src/repository.ts:259` — `deleteByUserAndDate`。
- [E8] `packages/db/src/repository.ts:299` — `DiaryRevisionRepository` interface。
- [E9] `packages/db/src/repository.ts:359` — `AuthSessionRepository` interface。
- [E10] `packages/db/src/migrations/0001_initial.sql:9` — `diary_entries` table。
- [E11] `packages/db/src/migrations/0002_diary_entry_revisions.sql:1` — `diary_entry_revisions` table。
- [E12] `packages/db/src/migrations/0003_auth_sessions.sql:1` — `auth_sessions` table。
- [E13] `packages/db/src/migrations/0004_generation_status.sql:1` — `generation_status` / `generation_error` 追加。
- [E14] `packages/db/src/repository.ts:86` — `toDiaryEntry` call。

- Edge Evidence Map（各エッジは “call + def” の 2 点セット）:
  - `findByUserAndDate` -> `toDiaryEntry`:
    - call: [E14] `packages/db/src/repository.ts:86`
    - def: [E1] `packages/db/src/repository.ts:15`

</details>

## スコープ

- 対象（In scope）:
  - D1 query 実行
  - schema/migration 管理
- 対象外（Non-goals）:
  - API route 実装
  - transaction orchestration
- 委譲（See）:
  - See: `apps/api/README.md`
- 互換性:
  - migration で明示的に管理
- 依存方向:
  - 許可:
    - db -> core types
  - 禁止:
    - db -> app code

<details><summary>根拠（Evidence）</summary>

- [E1] `packages/db/src/repository.ts:1`
- [E2] `packages/db/package.json:9`
</details>

## ローカル開発

- 依存インストール: `make install`
- 環境変数: `wrangler` の local D1 設定
- 起動: N/A
- 確認: `make db-migrate`, `make db-migrate-remote`

<details><summary>根拠（Evidence）</summary>

- [E1] `packages/db/package.json:9`
- [E2] `packages/db/package.json:10`
- [E3] `Makefile:32`
- [E4] `Makefile:35`
</details>

## ディレクトリ構成

```text
.
└── packages/db/
    ├── src/                             # DB実装 / See: src/README.md
    └── README.md                        # この文書
```

## 公開インタフェース

### 提供するもの / 提供しないもの

- 提供:
  - `createDiaryRepository`
  - `createDiaryRevisionRepository`
  - `createUserRepository`
  - `createAuthSessionRepository`
  - `DiaryRow` / `UserRow`
  - `DiaryEntryRevisionRow`
  - `AuthSessionRow`
- 非提供:
  - DB connection lifecycle

### エントリポイント / エクスポート（SSOT）

| 公開シンボル            | 種別      | 定義元              | 目的              | 根拠                                            |
| ----------------------- | --------- | ------------------- | ----------------- | ----------------------------------------------- |
| `createDiaryRepository` | function  | `src/repository.ts` | D1 repository生成 | `packages/db/src/repository.ts:77`              |
| `createDiaryRevisionRepository` | function  | `src/repository.ts` | revision 追記 | `packages/db/src/repository.ts:303`              |
| `createUserRepository`  | function  | `src/repository.ts` | D1 user read/write | `packages/db/src/repository.ts:321`              |
| `createAuthSessionRepository` | function | `src/repository.ts` | D1 auth session | `packages/db/src/repository.ts:367` |
| `DiaryRow`              | interface | `src/schema.ts`     | row契約           | `packages/db/src/schema.ts:9`                   |
| `UserRow`               | interface | `src/schema.ts`     | row契約           | `packages/db/src/schema.ts:30`                  |
| `DiaryEntryRevisionRow` | interface | `src/schema.ts`     | revision row契約  | `packages/db/src/schema.ts:22`                  |
| `AuthSessionRow`        | interface | `src/schema.ts`     | auth session row契約 | `packages/db/src/schema.ts:38`                  |
| `0001_initial.sql`      | migration | `src/migrations`    | schema初期化      | `packages/db/src/migrations/0001_initial.sql:1` |
| `0002_diary_entry_revisions.sql` | migration | `src/migrations`    | revision 追加     | `packages/db/src/migrations/0002_diary_entry_revisions.sql:1` |
| `0003_auth_sessions.sql` | migration | `src/migrations`    | auth session追加  | `packages/db/src/migrations/0003_auth_sessions.sql:1` |
| `0004_generation_status.sql` | migration | `src/migrations` | generation status追加 | `packages/db/src/migrations/0004_generation_status.sql:1` |

### 使い方（必須）

```ts
import { createDiaryRepository, createUserRepository } from "@future-diary/db";

const userRepo = createUserRepository(db);
await userRepo.upsertUser({ id: "u1", timezone: "Asia/Tokyo" });

const diaryRepo = createDiaryRepository(db);
const entry = await diaryRepo.findByUserAndDate("u1", "2026-02-07");
```

### 依存ルール

- 許可する import:
  - `@future-diary/core` の型
- 禁止する import:
  - `apps/*`

<details><summary>根拠（Evidence）</summary>

- [E1] `packages/db/src/repository.ts:1`
- [E2] `packages/db/src/repository.ts:2`
</details>

## 契約と検証

### 契約 SSOT

- `src/schema.ts`
- `src/migrations/*.sql`

### 検証入口（CI / ローカル）

- [E1] `bun --cwd packages/db run typecheck`
- [E2] `bun run --cwd packages/db migrate`
- [E3] `bun run --cwd packages/db migrate-remote`

### テスト（根拠として使う場合）

| テストファイル | コマンド                                   | 検証内容             | 主要 assertion   | 根拠                          |
| -------------- | ------------------------------------------ | -------------------- | ---------------- | ----------------------------- |
| N/A            | `bun run --cwd packages/db migrate-remote` | remote migration適用 | SQL syntax valid | `packages/db/package.json:10` |

<details><summary>根拠（Evidence）</summary>

- [E1] `packages/db/src/schema.ts:1`
- [E2] `packages/db/src/migrations/0001_initial.sql:13`
</details>

## 設計ノート

- データ形状:
  - `DiaryRow` と `DiaryEntry` の相互変換。
- 失敗セマンティクス:
  - DB層エラーは例外伝播（将来 Result 変換余地あり）。
- メインフロー:
  - prepare -> bind -> first/run。
- I/O 境界:
  - D1 statement execution。
- トレードオフ:
  - 最小抽象で D1 依存を局所化。

```mermaid
flowchart TD
  RP["packages/db/src/repository.ts::findByUserAndDate"] -->|"boundary(I/O)"| D1["D1DatabaseLike.prepare"]
  RP -->|"call"| MAP["toDiaryEntry"]
  U["createDraftIfMissing"] -->|"boundary(I/O)"| SQL["INSERT ... ON CONFLICT DO NOTHING"]
```

<details><summary>根拠（Evidence）</summary>

- [E1] `packages/db/src/repository.ts:72`
- [E2] `packages/db/src/repository.ts:78`
- [E3] `packages/db/src/repository.ts:107`
</details>

## 品質

- テスト戦略:
  - 型チェック + migration 実行検証。
- 主なリスクと対策（3〜7）:

| リスク           | 対策（検証入口）                 | 根拠                                             |
| ---------------- | -------------------------------- | ------------------------------------------------ |
| schema差異       | migrationをSSOT化                | `packages/db/src/migrations/0001_initial.sql:1`  |
| domain変換不整合 | `toDiaryEntry` 単一点変換        | `packages/db/src/repository.ts:15`               |
| 重複生成         | `UNIQUE(user_id, date)` + `createDraftIfMissing` | `packages/db/src/migrations/0001_initial.sql:19` |

<details><summary>根拠（Evidence）</summary>

- [E1] `packages/db/src/repository.ts:15`
- [E2] `packages/db/src/repository.ts:107`
- [E3] `packages/db/src/migrations/0001_initial.sql:19`
</details>

## 内部

<details>
<summary>品質（関数型プログラミング観点） / OPEN / ISSUE / SUMMARY</summary>

### 品質（関数型プログラミング観点）

| 項目               | 判定 | 理由                                  | 根拠                               |
| ------------------ | ---- | ------------------------------------- | ---------------------------------- |
| 副作用の隔離       | YES  | D1呼び出しを repository に限定        | `packages/db/src/repository.ts:69` |
| データと計算の分離 | YES  | `schema.ts` と `repository.ts` を分離 | `packages/db/src/schema.ts:1`      |
| 例外より型         | NO   | DB例外をそのまま伝播                  | `packages/db/src/repository.ts:71` |

### [OPEN]

- [OPEN][TODO] DB error の Result化
  - 背景: core 方針との整合。
  - 現状: exception pass-through。
  - 受入条件:
    - 境界で例外をドメインエラーへ変換。
  - 根拠:
    - `packages/db/src/repository.ts:71`

### [ISSUE]

- なし。

### [SUMMARY]

- DB境界は query と schema を局所化している。

</details>
