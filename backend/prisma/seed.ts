import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "root@saraky.com" },
    update: {},
    create: {
      name: "مدير النظام",
      email: "root@saraky.com",
      password: await bcrypt.hash("root1234", 10),
      role: "ROOT",
    },
  });
  console.log("Root ready: root@saraky.com");

  await prisma.user.upsert({
    where: { email: "admin@saraky.com" },
    update: {},
    create: {
      name: "المدير",
      email: "admin@saraky.com",
      password,
      role: "ADMIN",
    },
  });
  console.log("Admin ready");

  await prisma.user.upsert({
    where: { email: "xfarouk7@gmail.com" },
    update: {},
    create: {
      name: "فاروق",
      email: "xfarouk7@gmail.com",
      password: await bcrypt.hash("1234", 10),
      role: "USER",
    },
  });
  console.log("User ready: xfarouk7@gmail.com");

  const project = await prisma.project.upsert({
    where: { code: "PRJ-001" },
    update: {},
    create: { code: "PRJ-001", name: "مشروع السويس", description: "مشروع خط السويس الإنشائي" },
  });

  const sectorSouth = await prisma.sector.upsert({
    where: { projectId_name: { projectId: project.id, name: "قطاع جنوب" } },
    update: {},
    create: { projectId: project.id, name: "قطاع جنوب" },
  });
  const sectorNorth = await prisma.sector.upsert({
    where: { projectId_name: { projectId: project.id, name: "قطاع شمال" } },
    update: {},
    create: { projectId: project.id, name: "قطاع شمال" },
  });
  console.log("Project + sectors ready");

  const equipment = [
    { code: "EX-01", name: "حفار", sectorId: sectorSouth.id },
    { code: "GR-02", name: "مولّد", sectorId: sectorNorth.id },
    { code: "LD-03", name: "لودر", sectorId: sectorSouth.id },
  ];

  for (const eq of equipment) {
    await prisma.equipment.upsert({
      where: { code: eq.code },
      update: {},
      create: {
        code: eq.code,
        name: eq.name,
        projectId: project.id,
        sectorId: eq.sectorId,
      },
    });
  }
  console.log("Sample equipment ready: " + equipment.map((e) => e.code).join(", "));

  await prisma.oilSchedule.upsert({
    where: { equipmentId_oilType: { equipmentId: (await prisma.equipment.findUnique({ where: { code: "EX-01" } }))!.id, oilType: "محرك" } },
    update: {},
    create: {
      equipmentId: (await prisma.equipment.findUnique({ where: { code: "EX-01" } }))!.id,
      oilType: "محرك",
      lastChangeMeter: 900,
      intervalHours: 150,
      warningBeforeHours: 20,
      nextDueMeter: 1050,
    },
  });
  console.log("Sample oil schedule ready");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
