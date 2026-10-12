// Fills a development database with FAKE trips, users and patients.
// Run with `npx prisma db seed` (or automatically after `prisma migrate reset`).
// Never run against a field install: it refuses in production.
import { config } from "dotenv";
import { fakerES_MX as faker } from "@faker-js/faker";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Specialty } from "../src/generated/prisma/client";
import { PREEXISTING_CONDITIONS, WATER_CONTAMINATION_CONDITIONS, WATER_SOURCES } from "../src/lib/shared/constants";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production.");
  process.exit(1);
}

const NODE_ID = process.env.NODE_ID ?? "dev-local";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_OWNER_URL }) });

faker.seed(2026);

const SPECIALTIES: Specialty[] = ["PHYSICIAN", "DENTIST", "PEDIATRICIAN"];

/** Every seeded account uses this password. Development only. */
export const DEV_PASSWORD = "dev only password 2026";

async function main() {
  if ((await db.trip.count()) > 0) {
    console.log("Database already has trips; skipping seed. Run `npx prisma migrate reset` to start over.");
    return;
  }

  // Users
  const admin = await db.user.create({
    data: { email: "admin@example.org", name: "Dev Admin", role: "ADMIN", status: "ACTIVE" },
  });
  const approved = { status: "ACTIVE" as const, approvedById: admin.id, approvedAt: new Date() };
  const doctors = await Promise.all(
    SPECIALTIES.map((specialty) =>
      db.user.create({
        data: {
          email: `${specialty.toLowerCase()}@example.org`,
          name: `Dr. ${faker.person.lastName()}`,
          role: "DOCTOR",
          specialty,
          ...approved,
        },
      }),
    ),
  );
  const [studentOn, studentOff] = await Promise.all(
    ["student.on", "student.off"].map((local) =>
      db.user.create({
        data: { email: `${local}@example.com`, name: faker.person.fullName(), role: "STUDENT", ...approved },
      }),
    ),
  );
  await db.user.create({
    data: { email: "pending.doctor@example.org", name: faker.person.fullName(), role: "DOCTOR" },
  });

  const passwordHash = await hash(DEV_PASSWORD, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const users = await db.user.findMany({ select: { id: true } });
  await db.account.createMany({
    data: users.map((u) => ({ userId: u.id, accountId: u.id, providerId: "credential", password: passwordHash })),
  });

  // Trips: a past one and the current one.
  const trips = await Promise.all(
    [
      { code: "11_2025", name: "November 2025 Guatemala", month: 11, year: 2025, active: false },
      { code: "05_2026", name: "May 2026 Guatemala", month: 5, year: 2026, active: true },
    ].map((t) => db.trip.create({ data: { ...t, location: "Guatemala", createdById: admin.id } })),
  );

  for (const trip of trips) {
    await db.tripMember.createMany({
      data: [
        { tripId: trip.id, userId: studentOn.id, enabled: true, enabledById: doctors[0].id, enabledAt: new Date() },
        { tripId: trip.id, userId: studentOff.id, enabled: false },
      ],
    });

    const count = trip.active ? 25 : 15;
    for (let n = 1; n <= count; n++) {
      await createPatient(trip.id, n, faker.helpers.arrayElement([...doctors, studentOn]).id);
    }
    await db.trip.update({ where: { id: trip.id }, data: { nextPatientNumber: count + 1 } });
  }

  console.log("Seeded fake data:");
  console.log("  trips    11_2025 (15 patients), 05_2026 (25 patients)");
  console.log("  users    admin@example.org, physician|dentist|pediatrician@example.org,");
  console.log("           student.on@example.com (enabled), student.off@example.com (switched off),");
  console.log("           pending.doctor@example.org (awaiting approval)");
  console.log(`  password "${DEV_PASSWORD}" for every account`);
}

async function createPatient(tripId: string, displayNumber: number, createdById: string) {
  const sex = faker.helpers.arrayElement(["female", "male"] as const);
  const isInfant = faker.number.int(10) === 0;
  const dateOfBirth = isInfant
    ? faker.date.recent({ days: 600 })
    : faker.date.birthdate({ mode: "age", min: 2, max: 90 });
  const conditions = faker.helpers.arrayElements(
    PREEXISTING_CONDITIONS.filter((c) => c !== "None" && c !== "Other"),
    { min: 0, max: 2 },
  );
  const takenAt = faker.date.recent({ days: 5 });
  const weightKg = faker.number.float({ min: isInfant ? 4 : 35, max: isInfant ? 12 : 110, fractionDigits: 1 });
  const heightCm = faker.number.int({ min: isInfant ? 50 : 140, max: isInfant ? 85 : 190 });
  const common = { originNodeId: NODE_ID, createdById };

  await db.patient.create({
    data: {
      tripId,
      displayNumber,
      firstName: faker.person.firstName(sex),
      lastName: faker.person.lastName(),
      dateOfBirth,
      gender: sex === "female" ? "FEMALE" : "MALE",
      phone: faker.helpers.maybe(() => faker.phone.number({ style: "national" })) ?? null,
      address: faker.location.city(),
      waterSource: faker.helpers.arrayElement(WATER_SOURCES),
      waterRiskRating: faker.helpers.arrayElement(["LOW", "MEDIUM", "HIGH"] as const),
      waterHistory: faker.helpers.arrayElements(WATER_CONTAMINATION_CONDITIONS, { min: 0, max: 2 }),
      assignedSpecialty: isInfant ? "PEDIATRICIAN" : faker.helpers.arrayElement(SPECIALTIES),
      ...common,
      conditions: {
        create: conditions.map((condition) => ({
          condition,
          severity: faker.helpers.arrayElement(["MILD", "MODERATE", "SEVERE"] as const),
          ...common,
        })),
      },
      vitals: {
        create: {
          takenAt,
          bpSystolic: faker.number.int({ min: 100, max: 160 }),
          bpDiastolic: faker.number.int({ min: 60, max: 100 }),
          heartRate: faker.number.int({ min: 60, max: 110 }),
          temperatureC: faker.number.float({ min: 36.2, max: 38.5, fractionDigits: 1 }),
          weightKg,
          heightCm,
          bmi: Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10,
          respiratoryRate: faker.number.int({ min: 12, max: 22 }),
          ...common,
        },
      },
    },
  });
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
