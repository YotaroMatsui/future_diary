import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "./ui-button";
import { cn } from "./utils";
import { weekdayLabels, type CalendarDay } from "./future-diary-types";

type DiaryCalendarPaneProps = {
  monthLabel: string;
  draftLoading: boolean;
  calendarDays: readonly CalendarDay[];
  selectedDate: string;
  todayIso: string;
  filledDates: ReadonlySet<string>;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onRefresh: () => Promise<void>;
  onSelectDate: (isoDate: string) => void;
};

export const DiaryCalendarPane = ({
  monthLabel,
  draftLoading,
  calendarDays,
  selectedDate,
  todayIso,
  filledDates,
  onPrevMonth,
  onNextMonth,
  onRefresh,
  onSelectDate,
}: DiaryCalendarPaneProps) => (
  <aside className="p-3 sm:p-4">
    <div className="mb-2 flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrevMonth} aria-label="前月">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <p className="flex-1 text-center text-sm font-semibold tracking-tight">{monthLabel}</p>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => {
          void onRefresh();
        }}
        disabled={draftLoading}
        aria-label="再取得"
      >
        {draftLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNextMonth} aria-label="翌月">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>

    <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
      {weekdayLabels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>

    <div className="grid grid-cols-7 gap-1">
      {calendarDays.map((day) => {
        const selected = day.isoDate === selectedDate;
        const isToday = day.isoDate === todayIso;
        const isFilled = filledDates.has(day.isoDate);

        return (
          <button
            key={day.isoDate}
            type="button"
            onClick={() => {
              onSelectDate(day.isoDate);
            }}
            className={cn(
              "relative h-9 rounded-xl border text-xs font-medium transition-colors",
              day.inCurrentMonth ? "border-border text-foreground" : "border-border/50 text-muted-foreground",
              selected && "border-primary bg-primary text-primary-foreground",
              isToday && !selected && "border-primary/60",
            )}
          >
            <span>{day.dayOfMonth}</span>
            <span
              className={cn(
                "pointer-events-none absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
                isFilled ? "bg-emerald-500" : "bg-transparent ring-1 ring-border/70",
                selected && (isFilled ? "bg-primary-foreground/90" : "ring-primary-foreground/70"),
              )}
            />
          </button>
        );
      })}
    </div>
  </aside>
);
