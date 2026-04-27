DROP INDEX "class_sections_ma_lop_key";

CREATE UNIQUE INDEX "class_sections_ma_lop_thoi_gian_thu_key"
ON "class_sections"("ma_lop", "thoi_gian", "thu");
