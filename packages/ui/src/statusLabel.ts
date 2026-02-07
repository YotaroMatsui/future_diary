import type { DiaryStatus } from "@future-diary/core";

export const diaryStatusLabel = (status: DiaryStatus): string => {
  switch (status) {
    case "draft":
      return "未来日記（下書き）";
    case "confirmed":
      return "確定日記";
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
};
