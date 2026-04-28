CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'ADMIN');

ALTER TABLE "students"
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
ALTER COLUMN "program" DROP NOT NULL;

INSERT INTO "students" (
    "student_id",
    "name",
    "email",
    "password",
    "role",
    "program",
    "course_year",
    "department",
    "is_active"
)
VALUES (
    '999999999',
    'System Admin',
    'admin@local.dev',
    '$2b$10$YnyIL3Q9dbqJSwEvlu0gjOsJMrJMFMUp8nmCj6K11FPY.x2sJ0TTm',
    'ADMIN',
    NULL,
    NULL,
    NULL,
    true
)
ON CONFLICT ("student_id") DO NOTHING;
