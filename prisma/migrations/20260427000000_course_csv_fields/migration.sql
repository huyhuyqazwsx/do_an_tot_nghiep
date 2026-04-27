ALTER TABLE "courses"
ADD COLUMN "tuition_credits" DECIMAL(5, 1);

ALTER TABLE "courses"
ALTER COLUMN "prerequisite" TYPE TEXT;

ALTER TABLE "courses"
ALTER COLUMN "weight" TYPE DECIMAL(3, 1)
USING "weight"::DECIMAL(3, 1);
