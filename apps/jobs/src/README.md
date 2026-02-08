# apps/jobs/src

`apps/jobs/src` は Jobs Worker の実装を保持する。

- `index.ts`: D1 -> Workers AI embeddings -> Vectorize upsert を行う reindex endpoint を提供する。
- `reindex.ts`: 手動実行用の reindex リクエストサンプルを標準出力する（`make vector-reindex`）。

- パス: `apps/jobs/src/README.md`
- 状態: Implemented
- 種別（Profile）: src-module
- 関連:
  - See: `../README.md`

<details><summary>目次</summary>

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

- `POST /v1/vector/reindex` を提供し、既存日記の vector index backfill を段階実行できるようにする。

<details><summary>根拠（Evidence）</summary>

- [E1] `apps/jobs/src/index.ts:154` — `POST /v1/vector/reindex`。
- [E2] `apps/jobs/src/index.ts:70` — `JOBS_TOKEN` チェック。
- [E3] `apps/jobs/src/reindex.ts:25` — サンプル JSON 出力。
</details>

## スコープ

- 対象（In scope）:
  - `index.ts`, `reindex.ts`
- 対象外（Non-goals）:
  - Queue/Workflow orchestration
- 委譲（See）:
  - See: `../README.md`

## ローカル開発

- 依存インストール: `make install`
- 環境変数: `cp ../.dev.vars.example ../.dev.vars`
- 起動: `bun --cwd apps/jobs run dev -- --port 8788`
- dry-run:

```bash
curl -X POST http://127.0.0.1:8788/v1/vector/reindex \
  -H "content-type: application/json" \
  -H "x-jobs-token: $JOBS_TOKEN" \
  -d '{"limit":50,"dryRun":true}'
```

## ディレクトリ構成

```text
.
└── apps/jobs/src/
    ├── index.ts                 # Worker entry
    ├── reindex.ts               # request sample generator
    └── README.md                # この文書
```

## 公開インタフェース

- `app` / `default.fetch`（Worker entry）
- `buildReindexRequest`（CLI helper）

## 契約と検証

- 検証入口（CI / ローカル）:
  - `bun --cwd apps/jobs run typecheck`
  - `bun --cwd apps/jobs run build`

## 設計ノート

- cursor paging で段階実行する（1リクエストで全件は処理しない）。
- Vectorize namespace は `userId` を使用する。

## 品質

- 日記本文はログへ出さない（userId は sha256 で識別子化して出力）。

## 内部

<details><summary>品質（関数型プログラミング観点） / OPEN / ISSUE / SUMMARY</summary>

### [OPEN]

- [OPEN] 大規模データ向けに Cron/Queues/Workflows へ移行

### [SUMMARY]

- `index.ts` が reindex の実境界、`reindex.ts` は補助 CLI。

</details>
