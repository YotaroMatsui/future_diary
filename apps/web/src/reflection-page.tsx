import { LoaderCircle, RefreshCw, RotateCcw, Save } from "lucide-react";
import type { UserModel } from "./api";
import type { ReflectionInsight } from "./reflection-analysis";
import { Button } from "./ui-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui-card";
import { Textarea } from "./ui-textarea";

type ReflectionPageProps = {
  model: UserModel | null;
  insight: ReflectionInsight | null;
  loading: boolean;
  saving: boolean;
  errorMessage: string | null;
  onChangeDiaryPurpose: (value: string) => void;
  onChangeDiaryStyle: (value: string) => void;
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
  onSave,
  onReset,
  onRefreshInsight,
}: ReflectionPageProps) => {
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

  return (
    <section className="fd-surface">
      <Card className="ring-0">
        <CardHeader>
          <CardTitle>振り返り</CardTitle>
          <CardDescription>
            「日記の目的」と「日記の特徴（筆致）」だけ整えると、未来日記の下書きが使いやすくなります。
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div>
            <p className="fd-field-label">日記の目的</p>
            <Textarea
              value={model.intent}
              onChange={(event) => {
                onChangeDiaryPurpose(event.target.value);
              }}
              placeholder="例: 予実を見える化して、翌日の改善ポイントを残す日記"
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
              placeholder="例: 端的に箇条書きで書き、最後に一言の反省を添える"
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
            初期提案に戻す
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
    </section>
  );
};
