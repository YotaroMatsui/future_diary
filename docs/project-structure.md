# Project Structure (Runtime Skeleton + README Topology)

このドキュメントは、`AGENTS.md` のディレクトリ方針に沿って初期化した実行骨格のSSOTです。

## Root

- `apps/`: 実行アプリ（API / Web / Jobs）
- `packages/`: 再利用モジュール（core / db / vector / ui）
- `infra/`: Cloudflare 関連設定
- `docs/`: 要件と構成ドキュメント

## Tree

```text
.
├── README.md
├── apps/
│   ├── README.md
│   ├── api/
│   │   ├── README.md
│   │   ├── .dev.vars.example
│   │   ├── src/
│   │   │   ├── README.md
│   │   │   ├── index.ts
│   │   │   ├── openaiResponses.ts
│   │   │   ├── vectorize.ts
│   │   │   └── index.test.ts
│   │   └── wrangler.toml
│   ├── web/
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── README.md
│   │   │   ├── App.tsx
│   │   │   ├── api.ts
│   │   │   └── main.tsx
│   │   └── vite.config.ts
│   └── jobs/
│       ├── README.md
│       ├── .dev.vars.example
│       ├── src/
│       │   ├── README.md
│       │   ├── index.ts
│       │   └── reindex.ts
│       └── wrangler.toml
├── packages/
│   ├── README.md
│   ├── core/
│   │   ├── README.md
│   │   └── src/
│   │       ├── README.md
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── futureDiary.ts
│   │       ├── futureDiary.test.ts
│   │       ├── futureDiaryLlm.ts
│   │       └── futureDiaryLlm.test.ts
│   ├── db/
│   │   ├── README.md
│   │   └── src/
│   │       ├── README.md
│   │       ├── index.ts
│   │       ├── schema.ts
│   │       ├── repository.ts
│   │       └── migrations/
│   │           ├── README.md
│   │           └── 0001_initial.sql
│   ├── vector/
│   │   ├── README.md
│   │   └── src/
│   │       ├── README.md
│   │       ├── cloudflare.test.ts
│   │       ├── index.ts
│   │       ├── cloudflare.ts
│   │       └── search.ts
│   └── ui/
│       ├── README.md
│       └── src/
│           ├── README.md
│           ├── index.ts
│           └── statusLabel.ts
├── docs/
│   ├── requirements-ssot.md
│   └── project-structure.md
├── Makefile
├── package.json
└── tsconfig.base.json
```

## Command Entry Points

- `make install`: bunで依存をインストール
- `make dev-api`: API Worker 開発サーバー起動
- `make dev-web`: Web (Vite) 開発サーバー起動
- `make db-migrate`: D1 migration 適用
- `make db-migrate-remote`: D1 remote migration 適用
- `make vector-reindex`: Vector再構築ジョブ実行
- `make lint`, `make test`, `make typecheck`, `make build`, `make ci`

## Notes

- D1 は `future-diary`（id: `fddf415b-ab33-405d-9845-e34375371822`）を使用する。
- Vectorize は `future-diary-index` を使用する。
  - dimensions は `AI_EMBEDDING_MODEL`（Workers AI embeddings）の出力次元と一致させる（不一致の場合 retrieval/upsert は fallback/skip される）。
- 現在のCI前提コマンドは `bun` 導入済み環境を前提とする。
- README は親を導線、子を詳細として責務分離している。
