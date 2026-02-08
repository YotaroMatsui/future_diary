# Prod Deploy Runbook (Cloudflare Workers + Pages + D1 + Vectorize)

このドキュメントは、`future-diary` を Cloudflare 上へ本番相当（MVP）で構築・デプロイし、`/health` と diary の `draft -> save -> confirm -> list` を smoke check するための手順 SSOT である。

## 前提

- Cloudflare アカウントを作成済み。
- `bun` が使える（`bun --version`）。
- `wrangler` は `bunx wrangler` 経由で実行する（ルート `package.json#devDependencies`）。

## 重要な注意（Security）

- 現状は **認証が無い**。API は CORS `origin="*"` のため、公開運用の前提が弱い。
  - 本番公開前に、認証と CORS allowlist（少なくとも `*` 禁止）を導入すること（別タスク）。

## リソース名（SSOT）

- Workers:
  - API: `future-diary-api`（config: `apps/api/wrangler.toml`）
  - Jobs: `future-diary-jobs`（config: `apps/jobs/wrangler.toml`）
- D1:
  - database name: `future-diary`（binding: `DB`）
- Vectorize:
  - index name: `future-diary-index`（binding: `VECTOR_INDEX`）
  - dimensions: `1024`, metric: `cosine`（embeddings model と一致必須）
- Pages:
  - project name（推奨）: `future-diary-web`

## 1. Cloudflare へのログイン

```bash
bunx wrangler whoami || bunx wrangler login
```

## 2. D1 を作成して migration を適用

### 2.1 D1 database を作成

```bash
bunx wrangler d1 create future-diary
```

出力された `database_id` を以下へ反映する:

- `apps/api/wrangler.toml` の `[[d1_databases]].database_id`
- `apps/jobs/wrangler.toml` の `[[d1_databases]].database_id`

### 2.2 migration を remote に適用

```bash
make db-migrate-remote
```

## 3. Vectorize index を作成

> 既に存在する場合は `info` で設定が一致することだけ確認する。

### 3.1 index 作成

```bash
bunx wrangler vectorize create future-diary-index --dimensions=1024 --metric=cosine
```

### 3.2 date metadata index（任意だが推奨）

`date < beforeDate` の server-side filter を使う場合、metadata index が必要。

```bash
bunx wrangler vectorize create-metadata-index future-diary-index --propertyName date --type string
```

### 3.3 設定確認

```bash
bunx wrangler vectorize info future-diary-index --json
```

## 4. Secrets / 環境変数

### 4.1 API Worker（`apps/api`）

Secrets:

- `APP_ENV`（必須）: `production`
- `OPENAI_API_KEY`（任意）: OpenAI API key。未設定時は deterministic 生成へフォールバック。

```bash
bunx wrangler secret put APP_ENV --config apps/api/wrangler.toml
bunx wrangler secret put OPENAI_API_KEY --config apps/api/wrangler.toml
```

Vars（非Secret）:

- `OPENAI_BASE_URL`, `OPENAI_MODEL`, `AI_EMBEDDING_MODEL`（`apps/api/wrangler.toml` の `[vars]`）

### 4.2 Jobs Worker（`apps/jobs`）

Secrets:

- `APP_ENV`（必須）: `production`
- `JOBS_TOKEN`（必須）: `/v1/vector/reindex` の簡易認可に使用

```bash
bunx wrangler secret put APP_ENV --config apps/jobs/wrangler.toml
bunx wrangler secret put JOBS_TOKEN --config apps/jobs/wrangler.toml
```

Vars（非Secret）:

- `AI_EMBEDDING_MODEL`（`apps/jobs/wrangler.toml` の `[vars]`）

### 4.3 Web（Pages: `apps/web`）

- `VITE_API_BASE_URL`（必須）: Web から叩く API base URL（例: `https://future-diary-api.<subdomain>.workers.dev`）

`VITE_*` は build 時に bundle へ埋め込まれるため、**デプロイ前に確定**させる。

## 5. Deploy

### 5.1 API Worker

```bash
bunx wrangler deploy --config apps/api/wrangler.toml
```

### 5.2 Jobs Worker

```bash
bunx wrangler deploy --config apps/jobs/wrangler.toml
```

### 5.3 Web (Pages)

ローカル build した static assets を `wrangler pages deploy` でデプロイする（MVP の SSOT）。

```bash
VITE_API_BASE_URL="https://<api-base-url>" bun --cwd apps/web run build
bunx wrangler pages project create future-diary-web || true
bunx wrangler pages deploy apps/web/dist --project-name future-diary-web
```

## 6. Smoke Check（デプロイ直後）

### 6.1 API health

```bash
API_BASE_URL="https://<api-base-url>"
curl "$API_BASE_URL/health"
```

期待値:

- `ok: true`
- `env: "production"`
- `service: "future-diary-api"`

### 6.2 draft -> save -> confirm -> list

```bash
API_BASE_URL="https://<api-base-url>"
USER_ID="smoke-user"
DATE="$(date +%F)"
TZ="Asia/Tokyo"

curl -sS -X POST "$API_BASE_URL/v1/future-diary/draft" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"date\":\"$DATE\",\"timezone\":\"$TZ\"}"

curl -sS -X POST "$API_BASE_URL/v1/diary/entry/save" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"date\":\"$DATE\",\"body\":\"smoke save at $DATE\"}"

curl -sS -X POST "$API_BASE_URL/v1/diary/entry/confirm" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"date\":\"$DATE\"}"

curl -sS -X POST "$API_BASE_URL/v1/diary/entries/list" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"onOrBeforeDate\":\"$DATE\",\"limit\":10}"
```

期待値（概要）:

- `/v1/future-diary/draft`: `ok: true` が返り、`meta.source` が `cached|llm|deterministic|fallback` のいずれかになる
- `/v1/diary/entry/save`: `ok: true` が返り、`body` が保存内容になる
- `/v1/diary/entry/confirm`: `ok: true` が返り、`entry.status` が `confirmed` になる
- `/v1/diary/entries/list`: `ok: true` が返り、`entries[].body` が取れる

### 6.3 Jobs health + dry-run reindex

```bash
JOBS_BASE_URL="https://<jobs-base-url>"
JOBS_TOKEN="<jobs-token>"

curl "$JOBS_BASE_URL/health"

curl -sS -X POST "$JOBS_BASE_URL/v1/vector/reindex" \
  -H 'content-type: application/json' \
  -H "x-jobs-token: $JOBS_TOKEN" \
  -d '{"limit":50,"dryRun":true}'
```

期待値（概要）:

- `/health`: `service: "future-diary-jobs"`
- `/v1/vector/reindex` dry-run: `ok: true`, `dryRun: true`

### 6.4 Web smoke

- Pages の URL を開く
- userId / timezone を入力
- draft が表示される
- edit -> save -> confirm が成功する
- history list に当日分が表示される

## 7. トラブルシュート（よくある原因）

- API が `MISSING_BINDING`:
  - `apps/api/wrangler.toml` の `[[d1_databases]]` / `[[vectorize]]` の設定が Cloudflare 側リソースと一致しているか確認。
- Vectorize が効かない/落ちる:
  - `future-diary-index` の dimensions が embeddings と一致しているか（`wrangler vectorize info`）。
  - metadata index（`date`）が無い場合、server-side filter が失敗し得る（client-side fallback は動くが性能は落ちる）。
- Jobs が `MISSING_SECRET`:
  - `JOBS_TOKEN` を secret として設定する（`wrangler secret put JOBS_TOKEN --config apps/jobs/wrangler.toml`）。
