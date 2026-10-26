export type TrackingMode = "HOURS" | "KM" | "BOTH";

export const UNCLASSIFIED_CATEGORY = "غير مصنف";

interface CategoryDefault {
  name: string;
  defaultTrackingMode: TrackingMode;
}

export function resolveTrackingSetup(input: {
  category?: CategoryDefault | null;
  explicitMode?: TrackingMode;
  explicitConfirmed?: boolean;
}) {
  const trackingMode =
    input.explicitMode ?? input.category?.defaultTrackingMode ?? "BOTH";
  return {
    trackingMode,
    trackingModeOverridden: input.explicitMode != null,
    trackingModeConfirmed:
      input.explicitConfirmed ??
      (input.explicitMode != null ||
        (input.category != null && input.category.name !== UNCLASSIFIED_CATEGORY)),
  };
}
