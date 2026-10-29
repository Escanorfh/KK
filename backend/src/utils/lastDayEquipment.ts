import prisma from "../config/prisma";
import { scopeOr } from "./scope";

export interface LastDayEquipmentCounts {
  /** تاريخ آخر سجل في شيت الـ day (السجل اليومي) — لو مفيش سجلات يبقى null */
  lastLogDate: Date | null;
  /** عدد المعدات الفريدة اللي ليها سجل في آخر يوم، مجمّعة حسب المشروع الحالي */
  byProject: Map<number | null, number>;
  /** عدد المعدات الفريدة اللي ليها سجل في آخر يوم، مجمّعة حسب القطاع الحالي */
  bySector: Map<number | null, number>;
}

/**
 * عدّ المعدات من شيت الـ day (السجل اليومي) بس:
 * بناخد أحدث تاريخ مسجل فيه سراكي، وبعدين بنعدّ المعدات الفريدة اللي لها سجل في اليوم ده،
 * مجمّعة حسب المشروع والقطاع اللي المعدة متسندالهم حاليًا.
 * ده أدق لعدّ المعدات لأن المعدات بتتنقل بين المشاريع — الإسناد الحالي لوحده مش كفاية.
 */
export async function lastDayEquipmentCounts(scope?: number[] | null): Promise<LastDayEquipmentCounts> {
  const byProject = new Map<number | null, number>();
  const bySector = new Map<number | null, number>();

  const own = scopeOr(scope);
  const last = await prisma.dailyLog.aggregate({ _max: { date: true } });
  const lastLogDate = last._max.date;
  if (!lastLogDate) return { lastLogDate: null, byProject, bySector };

  // كل معدة بتسجّل مرة واحدة في نفس اليوم (قيد فريد [date, equipmentId]) — يعني كل سطر معدة فريدة
  const logs = await prisma.dailyLog.findMany({
    where: {
      date: lastLogDate,
      ...(own ? { equipment: { OR: own } } : {}),
    },
    select: { equipment: { select: { projectId: true, sectorId: true } } },
  });

  for (const log of logs) {
    const pid = log.equipment.projectId ?? null;
    byProject.set(pid, (byProject.get(pid) ?? 0) + 1);
    const sid = log.equipment.sectorId ?? null;
    if (sid != null) bySector.set(sid, (bySector.get(sid) ?? 0) + 1);
  }

  return { lastLogDate, byProject, bySector };
}
