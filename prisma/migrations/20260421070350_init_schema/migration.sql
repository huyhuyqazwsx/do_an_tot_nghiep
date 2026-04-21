/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "program" VARCHAR(5) NOT NULL,
    "course_year" INTEGER,
    "department" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "english_name" VARCHAR(300),
    "credits" INTEGER NOT NULL,
    "khoi_luong" VARCHAR(20),
    "department" VARCHAR(100),
    "prerequisite" VARCHAR(20),
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ma_lop" VARCHAR(20) NOT NULL,
    "ma_lop_kem" VARCHAR(20),
    "course_id" UUID NOT NULL,
    "semester" VARCHAR(10) NOT NULL,
    "thu" INTEGER,
    "kip" VARCHAR(10),
    "tiet_bd" INTEGER,
    "tiet_kt" INTEGER,
    "thoi_gian" VARCHAR(20),
    "tuan" VARCHAR(50),
    "phong" VARCHAR(50),
    "loai_lop" VARCHAR(20),
    "dat_mo" VARCHAR(5),
    "trang_thai" VARCHAR(50),
    "can_tn" BOOLEAN NOT NULL DEFAULT false,
    "ghi_chu" TEXT,
    "sl_max" INTEGER NOT NULL DEFAULT 0,
    "sl_dk" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "class_section_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_grades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "semester" VARCHAR(10) NOT NULL,
    "grade_letter" VARCHAR(2) NOT NULL,
    "grade_point" DECIMAL(3,1),
    "grade_number" DECIMAL(4,1),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "semester" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100),
    "open_at" TIMESTAMP(3) NOT NULL,
    "close_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "name" VARCHAR(100),
    "student_filter" JSONB NOT NULL,
    "open_at" TIMESTAMP(3) NOT NULL,
    "close_at" TIMESTAMP(3) NOT NULL,
    "prewarm_at" TIMESTAMP(3) NOT NULL,
    "is_prewarmed" BOOLEAN NOT NULL DEFAULT false,
    "prewarmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_student_id_key" ON "students"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_email_key" ON "students"("email");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "class_sections_ma_lop_key" ON "class_sections"("ma_lop");

-- CreateIndex
CREATE INDEX "idx_class_sections_course" ON "class_sections"("course_id");

-- CreateIndex
CREATE INDEX "idx_class_sections_semester" ON "class_sections"("semester");

-- CreateIndex
CREATE INDEX "idx_class_sections_ma_lop" ON "class_sections"("ma_lop");

-- CreateIndex
CREATE INDEX "idx_registrations_student" ON "registrations"("student_id");

-- CreateIndex
CREATE INDEX "idx_registrations_section" ON "registrations"("class_section_id");

-- CreateIndex
CREATE INDEX "idx_registrations_status" ON "registrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_student_id_class_section_id_key" ON "registrations"("student_id", "class_section_id");

-- CreateIndex
CREATE INDEX "idx_grades_student_course" ON "student_grades"("student_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_grades_student_id_course_id_semester_key" ON "student_grades"("student_id", "course_id", "semester");

-- CreateIndex
CREATE INDEX "idx_outbox_status" ON "outbox"("status");

-- CreateIndex
CREATE INDEX "idx_outbox_created" ON "outbox"("created_at");

-- AddForeignKey
ALTER TABLE "class_sections" ADD CONSTRAINT "class_sections_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_class_section_id_fkey" FOREIGN KEY ("class_section_id") REFERENCES "class_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_grades" ADD CONSTRAINT "student_grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_grades" ADD CONSTRAINT "student_grades_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_slots" ADD CONSTRAINT "registration_slots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "registration_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
