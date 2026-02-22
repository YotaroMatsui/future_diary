import { LoaderCircle, PencilLine, WandSparkles } from "lucide-react";
import { Textarea } from "./ui-textarea";
import { Button } from "./ui-button";

type DiaryEditorPaneProps = {
  indicatorText: string;
  indicatorBusy: boolean;
  deleting: boolean;
  draftLoading: boolean;
  selectedDate: string;
  editorDate: string;
  errorMessage: string | null;
  draftBody: string;
  bootstrapping: boolean;
  onRegenerate: () => Promise<void>;
  onEditorFocus: () => void;
  onEditorBlur: () => Promise<void>;
  onEditorChange: (value: string) => void;
};

export const DiaryEditorPane = ({
  indicatorText,
  indicatorBusy,
  deleting,
  draftLoading,
  selectedDate,
  editorDate,
  errorMessage,
  draftBody,
  bootstrapping,
  onRegenerate,
  onEditorFocus,
  onEditorBlur,
  onEditorChange,
}: DiaryEditorPaneProps) => (
  <div className="border-border/70 border-b p-3 sm:p-4 lg:border-r lg:border-b-0">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="inline-flex items-center gap-2 rounded-full bg-muted/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        {indicatorBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PencilLine className="h-3.5 w-3.5" />}
        <span>{indicatorText}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="text-primary hover:bg-primary/10 hover:text-primary"
        onClick={() => {
          void onRegenerate();
        }}
        disabled={deleting || draftLoading || selectedDate !== editorDate}
        aria-label="日記を再生成"
      >
        {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
      </Button>
    </div>

    {errorMessage && (
      <p className="mb-2 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs leading-relaxed text-destructive">
        {errorMessage}
      </p>
    )}

    <Textarea
      value={draftBody}
      onFocus={onEditorFocus}
      onBlur={() => {
        void onEditorBlur();
      }}
      onChange={(event) => {
        onEditorChange(event.target.value);
      }}
      placeholder="ここに書く"
      disabled={draftLoading || bootstrapping}
      className="min-h-[56dvh] border-border/0 bg-transparent text-[15px] leading-7 shadow-none focus-visible:ring-0"
    />
  </div>
);
