import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const semester = '20242';

  // 1. Fetch all sections (IT, MI, SSH)
  const classSections = await prisma.classSection.findMany({
    where: {
      semester,
      sectionType: 'LT_BT',
      maxCapacity: { gte: 100 },
      requiresLab: false,
      // OR: [
      //   { course: { code: { startsWith: 'IT' } } },
      //   { course: { code: { startsWith: 'MI' } } },
      //   { course: { code: { startsWith: 'SSH' } } },
      // ],
    },
    include: { course: { select: { id: true, code: true } } },
  });

  console.log(`Tìm thấy ${classSections.length} lớp học phần (IT, MI, SSH).`);

  if (classSections.length === 0) {
    console.log('Không có lớp nào, vui lòng kiểm tra lại database.');
    return;
  }

  // 2. Gom nhóm các row có cùng sectionCode (1 mã lớp có thể có nhiều buổi học/tuần)
  const sectionGroups = new Map<string, typeof classSections>();
  for (const s of classSections) {
    const group = sectionGroups.get(s.sectionCode) ?? [];
    group.push(s);
    sectionGroups.set(s.sectionCode, group);
  }

  // 3. Tạo các "set" đăng ký: mỗi set = 1 mã LT_BT (Lý thuyết + Bài tập)
  //    Lớp LT_BT thường có sức chứa lớn (100-200) thay vì lớp BT chỉ có ~50
  type ClassSet = {
    courseId: string;
    courseCode: string;
    btCode: string;
    ltCode: string;
    codes: string[];
    sections: typeof classSections;
  };

  const validSets: ClassSet[] = [];

  for (const [code, rows] of sectionGroups.entries()) {
    const firstRow = rows[0];

    validSets.push({
      courseId: firstRow.courseId,
      courseCode: firstRow.course.code,
      btCode: code,
      ltCode: code,
      codes: [code],
      sections: rows,
    });
  }

  console.log(`Tạo được ${validSets.length} sets (mỗi set = 1 lớp LT_BT sức chứa > 100).`);

  // 4. Hàm check trùng lịch
  function isConflict(setA: ClassSet, setB: ClassSet): boolean {
    for (const a of setA.sections) {
      for (const b of setB.sections) {
        if (a.sectionCode === b.sectionCode) continue;
        if (!a.dayOfWeek || !b.dayOfWeek || !a.timeOfDay || !b.timeOfDay) continue;
        if (a.dayOfWeek === b.dayOfWeek && a.timeOfDay === b.timeOfDay) {
          const aStart = a.startPeriod ?? 1;
          const aEnd = a.endPeriod ?? 12;
          const bStart = b.startPeriod ?? 1;
          const bEnd = b.endPeriod ?? 12;
          if (Math.max(aStart, bStart) <= Math.min(aEnd, bEnd)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Lọc set bị trùng lịch nội bộ (giữa LT và BT cùng set)
  const finalSets = validSets.filter(set => !isConflict(set, set));
  console.log(`Sau khi lọc trùng lịch nội bộ, còn lại ${finalSets.length} sets.`);

  // 5. Tạo các Batch
  const numBatches = 100;
  const coursesPerBatch = 4;
  const batches: string[][] = [];

  for (let i = 0; i < numBatches; i++) {
    const currentBatchSets: ClassSet[] = [];
    const currentBatchCourseIds = new Set<string>();

    // Xáo trộn mảng cho mỗi batch để luôn lấy ngẫu nhiên
    const shuffledSets = [...finalSets].sort(() => 0.5 - Math.random());

    // Cố gắng tìm 4 môn học không trùng nhau cho batch này
    for (const candidate of shuffledSets) {
      if (currentBatchSets.length >= coursesPerBatch) break;

      // Cùng môn học -> bỏ qua
      if (currentBatchCourseIds.has(candidate.courseId)) continue;

      // Check trùng lịch với các set đã chọn trong batch
      const conflict = currentBatchSets.some(selected => isConflict(candidate, selected));
      if (!conflict) {
        currentBatchSets.push(candidate);
        currentBatchCourseIds.add(candidate.courseId);
      }
    }

    // Phẳng hoá các mã lớp từ các sets đã chọn
    const batchCodes = [...new Set(currentBatchSets.flatMap(set => set.codes))];
    batches.push(batchCodes);
  }

  fs.writeFileSync('./scripts/k6/section-codes.json', JSON.stringify(batches, null, 2));
  console.log(`\nĐã tạo ${numBatches} batches. Mỗi batch có ${batches[0]?.length ?? 0} mã lớp (toàn bộ là lớp LT_BT).`);
  console.log(`Ghi thành công vào scripts/k6/section-codes.json`);

  // In sample batch
  console.log(`\n--- Batch 0 ---`);
  for (const set of [...finalSets].filter(s => batches[0]?.includes(s.btCode))) {
    console.log(`  ${set.courseCode}: LT_BT=${set.btCode} (Sức chứa: ${set.sections[0].maxCapacity})`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
