# コーディング規約

## 姿勢（Posture）

- 本番環境で利用できる品質で、エンドツーエンドの成果物を提供する。ハック、場当たり的な回避策、部分的な納品はしない。
- タスクは完了まで責任を持って遂行する。面倒、または複雑という理由で止めない。要件が本質的に矛盾している場合、または重大な確認事項が解決しないために進められない場合にのみ中断する。
- 中断を最小限にする。「進めてよいですか？」を繰り返し確認しない。進行を妨げている点を解消するために必要な質問だけを行う。
- 実際の検証を優先する。ユニットテストではI/O境界におけるモックやスタブを許容するが、最終的な信頼性は可能な限り実統合・エンドツーエンドのテストで担保する。
- ユーザーの進め方が不明確、または最適でない場合は、目的を満たしつつより良い現代的な代替案を提案する。
- コードベースを整理された状態に保つ。境界と責務を明確にし、変更をどこに入れるべきかを決めてから実装する。
- 効果（副作用）は境界で隔離し、コアは参照透過な純粋関数として保つ（functional core / imperative shell）。
- 共有ミュータブル状態を持ち込まない。不変値を共有し、更新は新値生成を基本とする。
- 期待される失敗は戻り値で表現し、例外は「想定外」または境界での変換に限定する。
- ログ、メトリクス、トレースは原則として境界で発行し、コアロジックに混入させない。
- 単位を小さく保つ。巨大なファイルやクラス（いわゆる“god”）を避け、変更が局所にとどまる構造を選ぶ。
- まず削除を検討する。重複、不要になったコード、過剰な抽象、時期尚早な一般化を増やさない。
- その場しのぎの分岐やフラグで問題を覆い隠さない。根本原因を解決する。
- エッジケースは局所化する。通常の処理（ハッピーパス）は簡潔で読みやすく保つ。
- 既定では後方互換性を維持しない。複雑さを増やすレガシーAPIや挙動を抱え込まない。
- 互換性が必要な場合は、最小限の互換レイヤーを実装し、削除計画と移行手順を文書化する。
- 破壊的変更が適切な場合は、破壊的変更として扱う。影響を明確に伝え、具体的な移行ルートを提示する。

## コア原則（Core principles）

- ビジネス上の成果から出発し、実際のドメインをモデル化する。
- 進化可能なモジュラーアーキテクチャを構築する。コンポーネントは疎結合にし、ファイルは小さく保つ。
- 技術的な卓越性を維持する。テストを備えたクリーンなコードを書き、継続的にリファクタリングして複雑性を低く保つ。
- 自動化を前提にする。ビルドとテストは常に実行可能で信頼できる状態にし、安全にデリバリーできるようにする。
- 本番運用性、セキュリティ、信頼性を考慮して設計する。
- 参照透過性（referential transparency）、不変データ（immutability）、合成可能性（composability）を設計上の不変条件として扱う。
- 効果（副作用）はI/O、時刻参照、乱数、例外送出、ミュータブル状態更新、外部サービス呼び出しなどを指す。必要な効果は型、引数、戻り値、境界層の責務として明示する。
- ドメインを型で表現し、不正状態を表現不能にする。境界のデータ変換（DTO→ドメイン等）は純粋関数として切り出す。

---

## ディレクトリ

- `apps/api`: Cloudflare Workers（Hono）で動く API（認証・日記CRUD・生成トリガ等）
- `apps/web`: React（Vite）ベースの Web アプリ（Cloudflare Pages で配信）
- `apps/jobs/*`（任意）: Workflows / Queues / Cron / Durable Objects 等のバックグラウンド実行（分離したい場合）
- `packages/core`: UI 非依存のドメイン・ユースケース・生成/RAGのコアロジック（functional core）
- `packages/db`: D1（SQLite）向けスキーマ/クエリ/マイグレーション補助（Drizzle など）
- `packages/vector`: Vectorize クライアント・検索ユーティリティ
- `packages/ui`: UIプリミティブ（任意）
- `infra/*`: Cloudflare 設定（wrangler, Pages, 環境変数/Secrets, 監視、必要なら Terraform）
- `docs/*`: 設計・運用ドキュメント

---

## アーキテクチャ概要

### 目的

- 当日初回オープンで「未来日記（下書き）」を生成し、編集→確定できる。
- 生成は失敗耐性が必要（遅延/リトライ/多重起動/二重生成防止）。

### 構成

- **Core（packages/core）**
  - ドメイン型・ユースケース・プロンプト組立・RAGの検索/整形等。
  - 副作用（DB/外部AI呼び出し/時刻/ログ）は境界に隔離。

- **API（apps/api：Workers + Hono）**
  - Web/将来のiOSクライアントから叩く単一のHTTP API。
  - D1 と Vectorize にアクセスし、Workflows/Queues にジョブを委譲。
  - 当日初回の生成は「冪等性（idempotency）・ロック・再実行」を設計に含める。

- **Web（apps/web：React + Vite + Pages）**
  - 日記の閲覧/編集UI。
  - “未来日記（下書き）”の表示、編集、確定、履歴閲覧。

- **Background（Workflows / Queues / Cron / Durable Objects）**
  - 生成・埋め込み・インデックス更新を非同期で実行。
  - 二重生成防止（ロック/状態）やリトライ、段階的生成（短文→拡張）をここで担保。

### Edge実行の原則（Workers前提）

- Node固有APIへの依存を避け、Web標準API中心で実装する。
- 重い処理はバックグラウンドへ退避し、リクエストは速く返す。
- データアクセスと外部AI呼び出しは境界層に閉じ込め、観測（ログ/メトリクス）は境界で出す。

---

## 技術スタック

### フロントエンド（Web）

- React + TypeScript
- Vite
- Tailwind CSS（任意）
- shadcn/ui（任意）
- 状態管理：Jotai（任意）/ TanStack Query（任意）

### API / 実行基盤

- Cloudflare Workers
- Hono（HTTPルーティング）
- 入出力バリデーション：Zod

### データ

- Cloudflare D1（永続：日記・ユーザ・生成状態・監査）
- Cloudflare Vectorize（ベクトル検索：過去書記の関連断片取得）
- Cloudflare R2（任意：エクスポート/添付/バックアップ）

### 非同期/ジョブ

- Cloudflare Workflows（推奨：多段・状態・リトライ）
- Cloudflare Queues（任意：埋め込み作成やインデックス更新を後ろに流す）
- Cron Triggers（任意：朝に事前生成等）
- Durable Objects（任意：ロック/排他/状態管理が必要な場合）

### AI

- Workers AI（Cloudflare内で完結させたい場合）
- 外部LLM（OpenAI等）を呼ぶ場合はAI Gateway等で観測/キャッシュ/レート制御（任意）

### 収益化（任意）

- Stripe（サブスク/課金）
- Turnstile（ボット対策）

---

## 環境とデータフロー

### 開発（Local）

- `wrangler dev` を中心にローカル開発する（Workers / D1 / Vectorize のローカルフローを含む）
- Secrets はローカルでは `.dev.vars` / `.env.local` を用い、コミットしない
- D1 はローカル実行（`--local`）とリモート（`--remote`）を明確に分け、誤接続を防ぐ

### 本番（Prod）

- Pages（Web） + Workers（API/Jobs） + D1 + Vectorize（+ R2）
- Secrets は `wrangler secret` / Cloudflare側の管理で統制し、開発端末から本番データへ直接アクセスしない
- 生成/埋め込みは Workflows/Queues 経由で実行し、APIの同期処理を軽く保つ

---

## パッケージマネージャ（Package manager）

- ルートはbunベースのモノレポとして運用する。依存追加・インストール・スクリプト実行は`bun`コマンドを使用し、npm/yarn/pnpmは使わない。
- Python領域（例：`etl/python`）では`uv`を使用する。ロックファイルは`etl/python/uv.lock`。依存追加・インストール・スクリプト実行は`uv`コマンドのみを使用し、pip/poetryは使わない。

---

## ローカル開発（Local development）

- API（Workers）は `apps/api` で `wrangler dev` を実行する（Makefileでラップしてよい）
- Web（Pages）は `apps/web` を `vite dev` で起動する（本番相当の動作確認が必要なら `wrangler pages dev` を使用）
- Web から API への接続先は `.env.local` 等で切り替える（例：`VITE_API_BASE_URL=http://127.0.0.1:8787`）
- D1 マイグレーションは `infra/` または `packages/db` の手順に従い、`wrangler d1 execute` で適用する
- Vectorize のインデックス更新/再構築は専用コマンド（ジョブ）で行い、UI操作に混ぜない

---

## 開発コマンド（Makefile）

- 共通の実行入口は Makefile。迷ったら `make help` を使う。
- 依存インストール: `make install`
- 開発起動:
  - API: `make dev-api`（= `wrangler dev` を想定）
  - Web: `make dev-web`（= `vite dev` を想定）
- DB/Index:
  - D1 マイグレーション: `make db-migrate`（= `wrangler d1 execute ...` を想定）
  - Vectorize 再構築: `make vector-reindex`（任意）
- ビルド/テスト: `make build` / `make test` / `make ci`
- Lint/Format: `make lint` / `make lint-fix` / `make format` / `make format-check`

> 注: 既存の Makefile / スクリプトがある場合は、その構造を崩さず、内部実装だけをWorkers/Pages向けに差し替える。

---

## Lint / Format

- コード品質は Ultracite (Oxlint + Oxfmt) と ruff で管理する。Next.js / React 向けプリセットを `.oxlintrc.json` に読み込んでいる。
- VS Code 利用時は Oxc 拡張機能（`oxc.oxc-vscode`）を入れると保存時整形と自動修正が有効になる。

---

## ブランチ命名規則（Branch naming）

- `{type}/{summary}` を基本とする。typeは `feat`（新機能）、`fix`（バグ修正）、`chore`（整備）、`docs`（ドキュメント）、`hotfix`（緊急修正）、`release`（リリース準備）のいずれか。
- summaryには英語の短い説明をケバブケースで記載する（例：`feat/add-payment-webhook`）。

---

## 完了の定義（Definition of done）

- Lint、型チェック、ビルドはエラーゼロであること。
- 関連するテストは実行され、すべて合格していること。
- Lint／コンパイラ／ビルドのエラーが残っている、またはテストが失敗している場合は未完了とする。

---

## ドキュメント管理（Documentation management）

- ユーザー向けの挙動、または運用に影響する変更（例：主要ディレクトリ／主要コンポーネントの追加・名称変更・削除、アプリシェル、レイアウト、ナビゲーション、テーマ、UIプリミティブ、設定、権限、デプロイ手順、外部依存、外部サービスとの統合）を行った場合は、該当するドキュメントを必ず更新し、実装と一致させる。
- ドキュメントは、どれを更新すべきかが分かるように責務を明確にする（例：アーキテクチャ、運用手順（Runbook）、セットアップ／オンボーディング、API、ADR、セキュリティ、運用全般）。リポジトリ内に体系（例：docs/配下）がある場合は、それに従う。
- 追記するだけで済ませず、読者が必要な情報を不足なく得られる状態を保つ（古い記述の削除、図や手順の更新、リンク切れの修正、用語の統一を含む）。
- 破壊的変更や移行が必要な場合は、移行ガイド、互換レイヤーの削除計画、期限（タイムライン）を文書化し、影響範囲と手順を明確にする。
- ドキュメント更新は完了条件に含まれる。実装が変わっているのにドキュメントが更新されていない場合は未完了とする。
- ルートに `README_template.md` を置き、README（各ディレクトリの `README.md`）を新規作成/大幅改修する場合は必ずこれを雛形として使用する。見出しとセクション構造（特に `## 内部` の折りたたみと「品質（関数型プログラミング観点） / [OPEN] / [ISSUE] / [SUMMARY]」）は維持する。
- README の配置ポリシー：実装コード/テスト/契約（スキーマ）が存在するディレクトリ階層には `README.md` を置く（=作成/維持）。それらが無く資産ファイルのみの階層には `README.md` を置かない（存在する場合は削除する）。
- 配置判断の目安：実装コード（例: `*.ts, *.tsx, *.js, *.mjs, *.cjs, *.py`）、テスト（例: `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`）、契約/スキーマ（例: パスに `schema|schemas|openapi|contracts` を含み、`*.json, *.yaml, *.yml` 等がある）。
- 親子の責務：親 README は一覧と導線のみ。子 README がある範囲の詳細は親に書かず、`See: <relative/path/to/README.md>` で委譲する（ASCII ツリーも子 README のあるディレクトリは内部展開しない）。
- README 内の断定は根拠（`path:line` もしくは実行コマンド）で裏付ける。根拠が取れない場合はテンプレの [OPEN] に落とす（推測で埋めない）。

---

## 作業記録（Decision log）

- 作業開始時に `.task/tmp/<yyyymmddhhmm>-<task_name>.md` をテンプレートとして `.task/<yyyymmddhhmm>-<task_name>.md` を新規作成し、項目に沿って記入する。
- 進捗、判断、リスクは同ファイルに都度記録する。
- `.task/` 配下は Git 管理外（ignore）とし、タスクファイルはローカルに保持する。
- `.task/tmp/` 配下のテンプレートは Git 管理する。

---

## スクラッチ領域の衛生（Scratch area hygiene）

- .scratch/ は一時的なスクリプトとメモにのみ使用し、Gitの追跡対象外にする。
- 作業完了時には残骸を削除し、リポジトリを汚さない。
