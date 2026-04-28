ALTER TABLE "students" RENAME TO "users";
ALTER TABLE "users" RENAME COLUMN "student_id" TO "user_id";

ALTER TABLE "registrations" RENAME COLUMN "student_id" TO "user_id";
ALTER TABLE "student_grades" RENAME COLUMN "student_id" TO "user_id";

ALTER INDEX "students_pkey" RENAME TO "users_pkey";
ALTER INDEX "students_student_id_key" RENAME TO "users_user_id_key";
ALTER INDEX "students_email_key" RENAME TO "users_email_key";

ALTER INDEX "idx_registrations_student" RENAME TO "idx_registrations_user";
ALTER INDEX "registrations_student_id_class_section_id_key" RENAME TO "registrations_user_id_class_section_id_key";
ALTER INDEX "idx_grades_student_course" RENAME TO "idx_grades_user_course";
ALTER INDEX "student_grades_student_id_course_id_semester_key" RENAME TO "student_grades_user_id_course_id_semester_key";

ALTER TABLE "registrations" RENAME CONSTRAINT "registrations_student_id_fkey" TO "registrations_user_id_fkey";
ALTER TABLE "student_grades" RENAME CONSTRAINT "student_grades_student_id_fkey" TO "student_grades_user_id_fkey";
