import { LoaderCircle, PanelRightOpen, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";
import type { UserModel } from "./api";
import type { ReflectionInsight } from "./reflection-analysis";
import { buildGenerationPromptPreview } from "./reflection-prompt";
import { Button } from "./ui-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui-card";
import { Input } from "./ui-input";
import { Textarea } from "./ui-textarea";

type ReflectionPageProps = {
  model: UserModel | null;
  insight: ReflectionInsight | null;
  loading: boolean;
  saving: boolean;
  errorMessage: string | null;
  onChangeDiaryPurpose: (value: string) => void;
  onChangeDiaryStyle: (value: string) => void;
  onChangeOpeningPhrase: (value: string) => void;
  onChangeClosingPhrase: (value: string) => void;
  onChangeMaxParagraphs: (value: number) => void;
  onChangeAvoidCopyingFromFragments: (value: boolean) => void;
  onResetPrompt: () => void;
  onSave: () => Promise<void>;
  onReset: () => Promise<void>;
  onRefreshInsight: () => Promise<void>;
};

export const ReflectionPage = ({
  model,
  insight,
  loading,
  saving,
  errorMessage,
  onChangeDiaryPurpose,
  onChangeDiaryStyle,
  onChangeOpeningPhrase,
  onChangeClosingPhrase,
  onChangeMaxParagraphs,
  onChangeAvoidCopyingFromFragments,
  onResetPrompt,
  onSave,
  onReset,
  onRefreshInsight,
}: ReflectionPageProps) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (loading || model === null) {
    return (
      <section className="fd-surface p-6">
        <div className="flex min-h-[48dvh] items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          振り返りメモを準備中...
        </div>
      </section>
    );
  }

  const openingPhrase = model.styleHints.openingPhrases[0] ?? "";
  const closingPhrase = model.styleHints.closingPhrases[0] ?? "";
  const promptPreview = buildGenerationPromptPreview(model);

  return (
    <section className="fd-surface">
      <Card className="ring-0">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>振り返り</CardTitle>
            <CardDescription>
              日記の目的と筆致を整え、必要なときだけドロワーで生成プロンプト全体を確認・修正できます。
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDrawerOpen(true);
            }}
            disabled={saving}
          >
            <PanelRightOpen className="h-4 w-4" />
            生成プロンプト
          </Button>
        </CardHeader>

        <CardContent className="space-y-5">
          <div>
            <p className="fd-field-label">日記の目的</p>
            <Textarea
              value={model.intent}
              onChange={(event) => {
                onChangeDiaryPurpose(event.target.value);
              }}
              placeholder="例: 今日の出来事を短く振り返り、明日の一歩を決める"
              className="min-h-[6rem]"
            />
          </div>

          <div>
            <p className="fd-field-label">日記の特徴（筆致）</p>
            <Textarea
              value={model.reflection.writingStyle}
              onChange={(event) => {
                onChangeDiaryStyle(event.target.value);
              }}
              placeholder="例: 事実・気づき・次の一歩を短く書く"
              className="min-h-[6rem]"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="fd-field-label mb-0">実践ナレッジ（自動抽出）</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void onRefreshInsight();
                }}
                disabled={saving || loading}
              >
                <RefreshCw className="h-4 w-4" />
                更新
              </Button>
            </div>

            <Textarea
              value={model.reflection.inferredProfile}
              readOnly
              aria-readonly="true"
              className="min-h-[7.5rem] cursor-default border-border/70 bg-muted/45 text-muted-foreground focus-visible:ring-0"
            />
            <p className="fd-helper-text">この欄は日記本文から自動更新され、直接編集はできません。</p>
            <p className="fd-helper-text">分析対象: {insight?.sampleSize ?? 0}件 / 平均 {Math.round(insight?.averageCharacters ?? 0)}文字</p>
          </div>

          {errorMessage && (
            <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs leading-relaxed text-destructive">
              {errorMessage}
            </p>
          )}
        </CardContent>

        <CardFooter className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void onReset();
            }}
            disabled={saving}
          >
            <RotateCcw className="h-4 w-4" />
            モデルを初期化
          </Button>
          <Button
            onClick={() => {
              void onSave();
            }}
            disabled={saving}
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存
          </Button>
        </CardFooter>
      </Card>

      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            aria-label="Close prompt drawer"
            onClick={() => {
              setDrawerOpen(false);
            }}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background px-4 py-4 shadow-2xl sm:px-6">
            <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-border bg-background px-4 pb-3 sm:-mx-6 sm:px-6">
              <div>
                <p className="text-sm font-semibold">生成プロンプト詳細</p>
                <p className="text-xs text-muted-foreground">頻繁には触らない項目をここでまとめて調整できます。</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDrawerOpen(false);
                }}
              >
                <X className="h-4 w-4" />
                閉じる
              </Button>
            </div>

            <div className="space-y-5 py-4">
              <div>
                <p className="fd-field-label">生成に使用されるプロンプト全体（プレビュー）</p>
                <Textarea
                  value={promptPreview}
                  readOnly
                  aria-readonly="true"
                  className="min-h-[18rem] cursor-default border-border/70 bg-muted/45 font-mono text-xs text-muted-foreground focus-visible:ring-0"
                />
                <p className="fd-helper-text">日付・タイムゾーン・当日の予定・参照断片は実行時に差し込まれます。</p>
              </div>

              <div>
                <p className="fd-field-label">日記の目的</p>
                <Textarea
                  value={model.intent}
                  onChange={(event) => {
                    onChangeDiaryPurpose(event.target.value);
                  }}
                  className="min-h-[5rem]"
                />
              </div>

              <div>
                <p className="fd-field-label">日記の特徴（筆致）</p>
                <Textarea
                  value={model.reflection.writingStyle}
                  onChange={(event) => {
                    onChangeDiaryStyle(event.target.value);
                  }}
                  className="min-h-[5rem]"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="fd-field-label">文頭フレーズ</p>
                  <Textarea
                    value={openingPhrase}
                    onChange={(event) => {
                      onChangeOpeningPhrase(event.target.value);
                    }}
                    className="min-h-[4.5rem]"
                  />
                </div>
                <div>
                  <p className="fd-field-label">文末フレーズ</p>
                  <Textarea
                    value={closingPhrase}
                    onChange={(event) => {
                      onChangeClosingPhrase(event.target.value);
                    }}
                    className="min-h-[4.5rem]"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="fd-field-label">段落数（1-6）</p>
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={String(model.styleHints.maxParagraphs)}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      if (Number.isNaN(parsed)) {
                        return;
                      }
                      onChangeMaxParagraphs(parsed);
                    }}
                  />
                </div>
                <div>
                  <p className="fd-field-label">参照断片の扱い</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={model.preferences.avoidCopyingFromFragments ? "secondary" : "outline"}
                      onClick={() => {
                        onChangeAvoidCopyingFromFragments(true);
                      }}
                    >
                      直接引用しない
                    </Button>
                    <Button
                      size="sm"
                      variant={!model.preferences.avoidCopyingFromFragments ? "secondary" : "outline"}
                      onClick={() => {
                        onChangeAvoidCopyingFromFragments(false);
                      }}
                    >
                      引用を許容
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">「プロンプト初期化」はシンプルな振り返り向け初期値を適用します。保存で確定します。</p>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      onResetPrompt();
                    }}
                    disabled={saving}
                  >
                    <RotateCcw className="h-4 w-4" />
                    プロンプト初期化
                  </Button>
                  <Button
                    onClick={() => {
                      void onSave();
                    }}
                    disabled={saving}
                  >
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    保存
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
};
