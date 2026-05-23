export interface ClassificationProgressState {
  visible: boolean;
  label: string;
  percent: number | null;
  valueLabel: string;
}

export interface ClassificationProgressSnapshot {
  processed: number;
  total: number;
  currentStart?: number;
  currentEnd?: number;
}

export function getClassificationProgressState(
  loadingPreview: boolean,
  progress: ClassificationProgressSnapshot | null
): ClassificationProgressState {
  if (!loadingPreview) {
    return { visible: false, label: "", percent: null, valueLabel: "" };
  }

  if (progress && progress.total > 0) {
    const processed = Math.min(progress.processed, progress.total);
    const percent = Math.round((processed / progress.total) * 100);
    if (
      progress.currentStart != null &&
      progress.currentEnd != null &&
      processed < progress.total
    ) {
      return {
        visible: true,
        label: `Classifying rows ${progress.currentStart}-${progress.currentEnd} of ${progress.total}`,
        percent,
        valueLabel: `${percent}%`,
      };
    }
    return {
      visible: true,
      label: `Classified ${processed} of ${progress.total} rows`,
      percent,
      valueLabel: `${percent}%`,
    };
  }

  return {
    visible: true,
    label: "Asking the AI to classify imported transactions",
    percent: null,
    valueLabel: "",
  };
}
