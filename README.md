# future-diary

`make ci` を単一入口として `apps/*` と `packages/*` の検証を実行し、Cloudflare Workers/Pages 前提の開発フローを統一する。統合の最小確認として `make smoke` で web -> api -> SQLite(D1 schema) のスモークテストを実行する。`package.json#workspaces` でモノレポ境界を固定し、実装責務は `apps/` と `packages/` に分離する。

- パス: `README.md`
- 状態: Implemented
- 種別（Profile）: package-root
- 関連:
  - See: `apps/README.md`
  - See: `packages/README.md`
  - See: `infra/README.md`
  - See: `docs/project-structure.md`
- 注意:
  - 断定は根拠（Evidence）で裏付ける。

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

- ルート `package.json` で workspace と共通スクリプトを定義する。
- `Makefile` で開発/検証コマンドを統一する。
- 子ディレクトリの README への導線を提供する。

<details><summary>根拠（Evidence）</summary>

- [E1] `package.json:4` — workspace が `apps/*`, `packages/*` を対象化。
- [E2] `package.json:8` — ルート scripts が `ci`/`smoke`/`lint`/`test`/`typecheck`/`build` を提供。
- [E3] `Makefile:24` — `make install` が `bun install` を呼び出す。
- [E4] `Makefile:60` — `make ci` が `bun run ci` を呼ぶ。
- [E5] `Makefile:51` — `make smoke` が `bun run smoke` を呼ぶ。

- Edge Evidence Map（各エッジは “call + def” の 2 点セット）:
  - EP -> N1:
    - call: [E4] `Makefile:60` — `ci` target calls `bun run ci`
    - def: [E2] `package.json:22` — `ci` script is defined
  - EP -> N2:
    - call: [E5] `Makefile:51` — `smoke` target calls `bun run smoke`
    - def: [E2] `package.json:11` — `smoke` script is defined

</details>

## スコープ

- 対象（In scope）:
  - モノレポの実行入口（Makefile / package.json scripts）
  - ワークスペース構造の定義
- 対象外（Non-goals）:
  - API/Web/Jobs/各packageの詳細仕様
- 委譲（See）:
  - See: `apps/README.md`
  - See: `packages/README.md`
- 互換性:
  - 既定で後方互換より単純性を優先
- 依存方向:
  - 許可:
    - root -> workspace scripts
  - 禁止:
    - root README に実装詳細を持ち込む

<details><summary>根拠（Evidence）</summary>

- [E1] `docs/project-structure.md:17` — `apps/` 配下構成。
- [E2] `docs/project-structure.md:45` — `packages/` 配下構成。
</details>

## ローカル開発

- 依存インストール: `make install`
- 環境変数: `apps/api/.dev.vars.example`, `apps/web/.env.example`
- 起動: `make dev-api`, `make dev-web`
- DB migration: `make db-migrate`（local）, `make db-migrate-remote`（remote）
- 確認: `make ci`

<details><summary>根拠（Evidence）</summary>

- [E1] `Makefile:23` — install。
- [E2] `Makefile:26` — dev-api。
- [E3] `Makefile:29` — dev-web。
- [E4] `Makefile:59` — ci。
</details>

## ディレクトリ構成

```text
.
├── apps/                         # 実行アプリ / See: apps/README.md
├── packages/                     # 共有モジュール / See: packages/README.md
├── infra/                        # Cloudflare設定/運用 / See: infra/README.md
├── docs/                         # 設計/仕様ドキュメント
├── Makefile                      # 共通コマンド入口
├── package.json                  # workspace定義とscripts
└── README.md                     # この文書
```

## 公開インタフェース

### 提供するもの / 提供しないもの

- 提供:
  - `make *` と `bun run *` の実行入口
- 非提供:
  - 個別機能のビジネスロジック

### エントリポイント / エクスポート（SSOT）

| 公開シンボル | 種別   | 定義元                     | 目的                 | 根拠              |
| ------------ | ------ | -------------------------- | -------------------- | ----------------- |
| `ci`         | script | `package.json::scripts.ci` | 品質ゲート統合実行   | `package.json:22` |
| `smoke`      | script | `package.json::scripts.smoke` | E2E smoke（web -> api -> d1） | `package.json:11` |
| `install`    | make   | `Makefile::install`        | 依存インストール入口 | `Makefile:23`     |
| `smoke`      | make   | `Makefile::smoke`          | E2E smoke 実行入口   | `Makefile:50`     |

### 使い方（必須）

```bash
make install
make ci
make smoke
```

### 依存ルール

- 許可する import:
  - N/A（rootはライブラリ公開しない）
- 禁止する import:
  - root から実装コードを直接参照

<details><summary>根拠（Evidence）</summary>

- [E1] `package.json:8` — scripts SSOT。
- [E2] `Makefile:1` — Make target SSOT。
</details>

## 契約と検証

### 契約 SSOT

- config:
  - `package.json` scripts
  - `Makefile` targets

### 検証入口（CI / ローカル）

- [E1] `make ci` — lint/test/typecheck/build を実行。
- [E2] `make smoke` — web -> api -> SQLite(D1 schema) の E2E smoke を実行。

### テスト（根拠として使う場合）

| テストファイル | コマンド  | 検証内容             | 主要 assertion | 根拠          |
| -------------- | --------- | -------------------- | -------------- | ------------- |
| N/A            | `make ci` | ルート統合品質ゲート | exit code 0    | `Makefile:59` |
| `apps/web/e2e-smoke.test.ts` | `make smoke` | E2E smoke（web -> api -> d1） | draft/save/confirm/list が成功 | `apps/web/e2e-smoke.test.ts:1` |

<details><summary>根拠（Evidence）</summary>

- [E1] `package.json:22` — `ci` script。
- [E2] `Makefile:59` — `ci` target。
- [E3] `package.json:11` — `smoke` script。
- [E4] `Makefile:50` — `smoke` target。
</details>

## 設計ノート

- データ形状:
  - scripts と targets の宣言型設定。
- 失敗セマンティクス:
  - 失敗時は `make` の非ゼロ終了コードで伝播。
- メインフロー:
  - `make ci` -> `bun run ci` -> workspace lint/test/typecheck/build。
- I/O 境界:
  - `make` / `bun` 実行が境界。
- トレードオフ:
  - ルートは orchestration のみを持つ。

```mermaid
flowchart TD
  MK["Makefile::ci"] -->|"call"| PKG["package.json::scripts.ci"]
  PKG -->|"call"| WS["workspaces scripts"]
```

<details><summary>根拠（Evidence）</summary>

- [E1] `Makefile:59` — `ci` target。
- [E2] `package.json:22` — `ci` script。
- [E3] `package.json:15` — `typecheck` script for workspaces。
</details>

## 品質

- テスト戦略:
  - Root は統合実行のみ。
- 主なリスクと対策（3〜7）:

| リスク                     | 対策（検証入口）                 | 根拠             |
| -------------------------- | -------------------------------- | ---------------- |
| scripts と Makefile の乖離 | `make ci` を単一入口に固定       | `Makefile:59`    |
| workspace 追加漏れ         | `package.json#workspaces` で管理 | `package.json:4` |

<details><summary>根拠（Evidence）</summary>

- [E1] `package.json:4` — workspace。
- [E2] `Makefile:59` — CI入口。
</details>

## 内部

<details>
<summary>品質（関数型プログラミング観点） / OPEN / ISSUE / SUMMARY</summary>

### 品質（関数型プログラミング観点）

| 項目         | 判定 | 理由                         | 根拠             |
| ------------ | ---- | ---------------------------- | ---------------- |
| 副作用の隔離 | YES  | rootはコマンド起動に責務限定 | `Makefile:24`    |
| 依存性注入   | N/A  | ライブラリではない           | `README.md:1`    |
| 契約指向     | YES  | scripts/targetsをSSOT化      | `package.json:8` |

### [OPEN]

- なし。

### [ISSUE]

- 現時点で blocker はなし（MVP の課題は [OPEN][TODO] に集約）。

### [SUMMARY]

- root は orchestration と導線だけを保持し、実装詳細は子 README に委譲する。
- `feat/auth-identity` で bearer token session 認証 + CORS allowlist + データ削除（アカウント/日記）を実装した。
- `feat/async-generation-orchestration` で Queues + DO lock による生成の非同期化と polling 契約を実装した。
- `docs/prod-deploy-runbook` で本番デプロイ runbook（Workers/Pages/D1/Vectorize）を `infra/prod-deploy-runbook.md` に集約した。

</details>
