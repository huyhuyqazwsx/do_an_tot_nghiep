ALTER TABLE "users" RENAME COLUMN "user_id" TO "student_code";

ALTER INDEX "users_user_id_key" RENAME TO "users_student_code_key";
