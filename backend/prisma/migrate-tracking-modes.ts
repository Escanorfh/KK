import "dotenv/config";
import prisma from "../src/config/prisma";
import { ensureDefaultCategories } from "../src/modules/equipments/equipment.service";
import { UNCLASSIFIED_CATEGORY } from "../src/modules/equipments/trackingMode";

function codePrefix(code: string): string | null {
  const match = code.trim().match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : null;
}

async function main() {
  const categories = await ensureDefaultCategories();
  const byPrefix = new Map<string, (typeof categories)[number]>();
  for (const category of categories) {
    for (const prefix of category.codePrefixes) {
      byPrefix.set(prefix.toUpperCase(), category);
    }
  }
  const unclassified =
    categories.find((category) => category.name === UNCLASSIFIED_CATEGORY) ?? null;

  const equipment = await prisma.equipment.findMany({
    include: {
      category: true,
      meterResets: { select: { hours: true, km: true } },
      _count: {
        select: {
          dailyLogs: { where: { endMeter: { not: null } } },
          maintenance: { where: { kmMeter: { not: null } } },
        },
      },
    },
    orderBy: { code: "asc" },
  });

  let assigned = 0;
  const review: Record<string, unknown>[] = [];

  for (const eq of equipment) {
    const hasHoursData =
      eq._count.dailyLogs > 0 || eq.meterResets.some((reset) => reset.hours != null);
    const hasKmData =
      eq._count.maintenance > 0 || eq.meterResets.some((reset) => reset.km != null);

    let category = eq.category;
    let trackingMode = eq.trackingMode;
    let trackingModeOverridden = eq.trackingModeOverridden;
    let trackingModeConfirmed = eq.trackingModeConfirmed;

    // لا نعيد ترحيل المعدات التي لها فئة مسبقًا، حفاظًا على أي تعديل يدوي لاحق
    if (!eq.categoryId) {
      const prefix = codePrefix(eq.code);
      category = (prefix ? byPrefix.get(prefix) : undefined) ?? unclassified;
      trackingMode = category?.defaultTrackingMode ?? "BOTH";
      trackingModeOverridden = false;
      trackingModeConfirmed = false;
    }

    const issues: string[] = [];
    if (trackingMode === "HOURS" || trackingMode === "BOTH") {
      if (!hasHoursData) issues.push("لا توجد قراءات ساعات مسجلة");
    }
    if (trackingMode === "KM" || trackingMode === "BOTH") {
      if (!hasKmData) issues.push("لا توجد قراءات كيلومترات مسجلة");
    }
    if (!category) issues.push("لا توجد فئة محددة");
    else if (category.name === UNCLASSIFIED_CATEGORY) issues.push("الفئة غير محددة");
    if (!eq.hasOdometer && trackingMode !== "HOURS") {
      issues.push("عداد الكيلومترات كان معطلًا قبل الترحيل");
    }

    if (!eq.categoryId) {
      trackingModeConfirmed = issues.length === 0;
      await prisma.equipment.update({
        where: { id: eq.id },
        data: {
          categoryId: category?.id ?? null,
          trackingMode,
          trackingModeOverridden,
          trackingModeConfirmed,
          hasOdometer: trackingMode !== "HOURS",
        },
      });
      assigned++;
    }

    if (issues.length > 0 || !trackingModeConfirmed) {
      review.push({
        equipmentId: eq.id,
        code: eq.code,
        category: category?.name ?? null,
        trackingMode,
        trackingModeConfirmed,
        issues,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        categories: categories.map((category) => ({
          id: category.id,
          name: category.name,
          codePrefixes: category.codePrefixes,
          defaultTrackingMode: category.defaultTrackingMode,
        })),
        equipment: equipment.length,
        assigned,
        confirmed: equipment.length - review.length,
        review,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
