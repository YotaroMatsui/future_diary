# apps/jobs

`apps/jobs` は vector index の backfill / reindex を行う Jobs Worker を提供する。

- `apps/jobs/src/index.ts`:
  - D1 の `diary_entries` をページングし、Workers AI embeddings で埋め込みを生成して Vectorize に upsert する。
  - エンドポイント: `POST /v1/vector/reindex`
- `apps/jobs/src/reindex.ts`:
  - 手動実行用に reindex リクエストのサンプル JSON を標準出力する（`make vector-reindex`）。

- パス: `apps/jobs/README.md`
- 状態: Implemented
- 種別（Profile）: src-module
- 関連:
  - See: `packages/vector/README.md`

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

- 既存日記の一括投入（backfill / reindex）を、HTTP で段階実行できるようにする。
- Jobs 用の簡易認可（`JOBS_TOKEN`）を提供する。

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/jobs/src/index.ts:1` — Vectorize upsert adapter 呼び出し。
- [E2] `apps/jobs/src/index.ts:154` — `POST /v1/vector/reindex`。
- [E3] `apps/jobs/src/index.ts:70` — `JOBS_TOKEN` チェック。
- [E4] `apps/jobs/src/reindex.ts:25` — サンプル JSON 出力。
</details>

## スコープ

- 対象（In scope）:
  - reindex endpoint（`/v1/vector/reindex`）
  - D1 scan（cursor paging）
  - Workers AI embeddings + Vectorize upsert
  - `JOBS_TOKEN` による簡易認可
- 対象外（Non-goals）:
  - Queue / Workflow orchestration
  - Vectorize の delete を伴う完全再構築（現状は upsert のみ）
- 委譲（See）:
  - See: `packages/vector/README.md`
- 互換性:
  - N/A

## ローカル開発

- 依存インストール: `make install`
- 環境変数: `cp apps/jobs/.dev.vars.example apps/jobs/.dev.vars`
- 起動: `bun --cwd apps/jobs run dev -- --port 8788`
- 確認:
  - `curl http://127.0.0.1:8788/health`
  - dry-run:

```bash
curl -X POST http://127.0.0.1:8788/v1/vector/reindex \
  -H "content-type: application/json" \
  -H "x-jobs-token: $JOBS_TOKEN" \
  -d '{"limit":50,"dryRun":true}'
```

注意:

- Vectorize は local dev が未サポートのため、実 upsert を検証する場合は `wrangler.toml` の `[[vectorize]]` に `remote = true` を付けて remote index を参照する。

## ディレクトリ構成

```text
.
└── apps/jobs/
    ├── src/                     # Worker 実装 / See: src/README.md
    ├── .dev.vars.example        # dev vars example
    ├── wrangler.toml            # Worker bindings
    ├── package.json             # scripts/deps
    └── README.md                # この文書
```

## 公開インタフェース

### HTTP

- `GET /health`
- `POST /v1/vector/reindex`

`POST /v1/vector/reindex` request:

- `userId?`: 対象ユーザに限定（省略時は全ユーザ）
- `cursor?`: `{ userId, date }`（省略時は先頭から）
- `limit?`: 1..200（default 50）
- `dryRun?`: true の場合、D1 scan のみで upsert を行わない

### CLI（補助）

```bash
make vector-reindex
```

## 契約と検証

- 検証入口（CI / ローカル）:
  - `bun --cwd apps/jobs run typecheck`
  - `bun --cwd apps/jobs run build`

## 設計ノート

- 1回のリクエストで全件を処理せず、cursor paging で繰り返し呼び出す前提。
- namespace は `userId` を使用する（Vectorize の `namespace`）。

## 品質

- ログに日記本文を出さない（userId は sha256 で識別子化して出力）。

## 内部

<details>
<summary>品質（関数型プログラミング観点） / OPEN / ISSUE / SUMMARY</summary>

### 品質（関数型プログラミング観点）

| 項目         | 判定 | 理由                   | 根拠                    |
| ------------ | ---- | ---------------------- | ----------------------- |
| 副作用の隔離 | YES  | D1/AI/Vectorize を境界に限定 | `apps/jobs/src/index.ts:154` |

### [OPEN]

- [OPEN] reindex の orchestration（Cron/Queues/Workflows）導入
  - 背景: 大量データでは HTTP の反復実行が必要。

### [ISSUE]

- なし。

### [SUMMARY]

- `apps/jobs` は D1 -> Workers AI embeddings -> Vectorize upsert の backfill 境界。

</details>
