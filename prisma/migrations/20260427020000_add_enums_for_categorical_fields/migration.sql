CREATE TYPE "StudentProgram" AS ENUM ('A', 'B', 'AB');
CREATE TYPE "ClassTimeOfDay" AS ENUM ('Sáng', 'Chiều', 'Tối');
CREATE TYPE "ClassSectionType" AS ENUM ('LT+BT', 'TN', 'TH', 'BT', 'LT', 'ĐA', 'TT', 'ĐATN', 'TTTN', 'TTKT', 'TTKS', 'ĐATNKS');
CREATE TYPE "SectionOpenGroup" AS ENUM ('A', 'B', 'AB');
CREATE TYPE "ClassSectionStatus" AS ENUM ('Điều chỉnh ĐK', 'Kết thúc ĐK', 'Huỷ lớp', 'Đang xếp TKB');
CREATE TYPE "RegistrationStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'PENDING');
CREATE TYPE "GradeLetter" AS ENUM ('A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F');
CREATE TYPE "OutboxEventType" AS ENUM ('REGISTRATION_SUCCESS', 'REGISTRATION_FAILED', 'REGISTRATION_CANCELLED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

ALTER TABLE "students"
ALTER COLUMN "program" TYPE "StudentProgram"
USING ("program"::"StudentProgram");

ALTER TABLE "class_sections"
ALTER COLUMN "kip" TYPE "ClassTimeOfDay"
USING (NULLIF("kip", '')::"ClassTimeOfDay"),
ALTER COLUMN "loai_lop" TYPE "ClassSectionType"
USING (NULLIF("loai_lop", '')::"ClassSectionType"),
ALTER COLUMN "dat_mo" TYPE "SectionOpenGroup"
USING (NULLIF("dat_mo", '')::"SectionOpenGroup"),
ALTER COLUMN "trang_thai" TYPE "ClassSectionStatus"
USING (NULLIF("trang_thai", '')::"ClassSectionStatus");

ALTER TABLE "registrations"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "RegistrationStatus"
USING ("status"::"RegistrationStatus"),
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "student_grades"
ALTER COLUMN "grade_letter" TYPE "GradeLetter"
USING ("grade_letter"::"GradeLetter");

ALTER TABLE "outbox"
ALTER COLUMN "event_type" TYPE "OutboxEventType"
USING ("event_type"::"OutboxEventType"),
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "OutboxStatus"
USING ("status"::"OutboxStatus"),
ALTER COLUMN "status" SET DEFAULT 'PENDING';
