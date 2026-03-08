import { DiaryCalendarPane } from "./diary-calendar-pane";
import { DiaryEditorPane } from "./diary-editor-pane";
import type { FutureDiaryAppModel } from "./use-future-diary-app";

type DiaryPageProps = {
  app: Pick<
    FutureDiaryAppModel,
    | "indicatorText"
    | "indicatorBusy"
    | "deleting"
    | "draftLoading"
    | "selectedDate"
    | "editorDate"
    | "errorMessage"
    | "draftBody"
    | "bootstrapping"
    | "monthLabel"
    | "calendarDays"
    | "todayIso"
    | "filledDates"
    | "regenerateEntry"
    | "focusEditor"
    | "blurEditor"
    | "changeDraftBody"
    | "goPrevMonth"
    | "goNextMonth"
    | "refreshDraft"
    | "selectDate"
  >;
};

export const DiaryPage = ({ app }: DiaryPageProps) => (
  <section className="fd-surface">
    <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]">
      <DiaryEditorPane
        indicatorText={app.indicatorText}
        indicatorBusy={app.indicatorBusy}
        deleting={app.deleting}
        draftLoading={app.draftLoading}
        selectedDate={app.selectedDate}
        editorDate={app.editorDate}
        errorMessage={app.errorMessage}
        draftBody={app.draftBody}
        bootstrapping={app.bootstrapping}
        onRegenerate={app.regenerateEntry}
        onEditorFocus={app.focusEditor}
        onEditorBlur={app.blurEditor}
        onEditorChange={app.changeDraftBody}
      />
      <DiaryCalendarPane
        monthLabel={app.monthLabel}
        draftLoading={app.draftLoading}
        calendarDays={app.calendarDays}
        selectedDate={app.selectedDate}
        todayIso={app.todayIso}
        filledDates={app.filledDates}
        onPrevMonth={app.goPrevMonth}
        onNextMonth={app.goNextMonth}
        onRefresh={app.refreshDraft}
        onSelectDate={app.selectDate}
      />
    </div>
  </section>
);
