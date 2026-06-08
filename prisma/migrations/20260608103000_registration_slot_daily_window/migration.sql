ALTER TABLE "registration_slots"
ADD COLUMN "start_date" VARCHAR(10),
ADD COLUMN "end_date" VARCHAR(10),
ADD COLUMN "start_time" VARCHAR(5),
ADD COLUMN "end_time" VARCHAR(5);

UPDATE "registration_slots"
SET
  "start_date" = COALESCE("start_date", to_char("open_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')),
  "end_date" = COALESCE("end_date", to_char("close_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')),
  "start_time" = COALESCE("start_time", to_char("open_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', 'HH24:MI')),
  "end_time" = COALESCE("end_time", to_char("close_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', 'HH24:MI'));

ALTER TABLE "registration_slots"
ALTER COLUMN "start_date" SET NOT NULL,
ALTER COLUMN "end_date" SET NOT NULL,
ALTER COLUMN "start_time" SET NOT NULL,
ALTER COLUMN "end_time" SET NOT NULL;

ALTER TABLE "registration_slots"
DROP COLUMN "open_at",
DROP COLUMN "close_at";

DROP INDEX IF EXISTS "idx_registration_slots_semester_student_time";
CREATE INDEX "idx_registration_slots_semester_student_time"
ON "registration_slots"("semester", "student_code_from", "student_code_to", "start_date", "end_date", "start_time", "end_time");
