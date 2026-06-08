ALTER TABLE "registration_slots"
ADD COLUMN "student_code_from" VARCHAR(20),
ADD COLUMN "student_code_to" VARCHAR(20);

UPDATE "registration_slots"
SET
  "student_code_from" = COALESCE("student_code_from", '0'),
  "student_code_to" = COALESCE("student_code_to", '99999999999999999999');

ALTER TABLE "registration_slots"
ALTER COLUMN "student_code_from" SET NOT NULL,
ALTER COLUMN "student_code_to" SET NOT NULL;

ALTER TABLE "registration_slots"
DROP COLUMN "student_filter",
DROP COLUMN "prewarm_at",
DROP COLUMN "is_prewarmed",
DROP COLUMN "prewarmed_at";

DROP INDEX IF EXISTS "idx_registration_slots_semester";
CREATE INDEX "idx_registration_slots_semester_student_time"
ON "registration_slots"("semester", "student_code_from", "student_code_to", "open_at", "close_at");
