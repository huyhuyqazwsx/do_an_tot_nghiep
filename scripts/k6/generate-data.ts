import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const semester = '20242';

  // 1. Fetch all sections
  const classSections = await prisma.classSection.findMany({
    where: {
      semester,
      maxCapacity: { gt: 100 },
      OR: [
        { course: { code: { startsWith: 'IT' } } },
        { course: { code: { startsWith: 'MI' } } },
        { course: { code: { startsWith: 'SSH' } } },
      ],
    },
    include: { course: { select: { id: true, code: true } } },
  });

  console.log(`Tìm thấy ${classSections.length} lớp học phần bắt đầu bằng IT, MI, SSH.`);

  if (classSections.length === 0) {
    console.log('Không có lớp nào, vui lòng kiểm tra lại database.');
    return;
  }

  // 2. Gom nhóm các row có cùng sectionCode
  type SectionGroup = {
    courseId: string;
    sectionCode: string;
    linkedSectionCode: string | null;
    rows: typeof classSections;
  };

  const sectionGroups = new Map<string, SectionGroup>();
  for (const s of classSections) {
    if (!sectionGroups.has(s.sectionCode)) {
      sectionGroups.set(s.sectionCode, {
        courseId: s.courseId,
        sectionCode: s.sectionCode,
        linkedSectionCode: s.linkedSectionCode,
        rows: [],
      });
    }
    sectionGroups.get(s.sectionCode)!.rows.push(s);
  }

  // 3. Gom nhóm các lớp hợp lệ (Sets) bằng đồ thị (để giải quyết pointer 1 chiều)
  type ClassSet = {
    courseId: string;
    sections: typeof classSections;
    codes: string[];
  };

  const adjList = new Map<string, Set<string>>();
  for (const [code, group] of sectionGroups.entries()) {
    if (!adjList.has(code)) adjList.set(code, new Set());
    if (group.linkedSectionCode && sectionGroups.has(group.linkedSectionCode)) {
      if (!adjList.has(group.linkedSectionCode)) adjList.set(group.linkedSectionCode, new Set());
      // Tạo link 2 chiều
      adjList.get(code)!.add(group.linkedSectionCode);
      adjList.get(group.linkedSectionCode)!.add(code);
    }
  }

  const validSets: ClassSet[] = [];
  const visited = new Set<string>();

  for (const code of sectionGroups.keys()) {
    if (visited.has(code)) continue;

    // BFS để tìm tất cả các mã lớp liên thông
    const queue = [code];
    const componentCodes: string[] = [];
    visited.add(code);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      componentCodes.push(curr);
      for (const neighbor of adjList.get(curr) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const currentSetRows = componentCodes.flatMap(c => sectionGroups.get(c)!.rows);

    validSets.push({
      courseId: sectionGroups.get(code)!.courseId, // courseId của các lớp trong component là như nhau
      sections: currentSetRows,
      codes: componentCodes,
    });
  }

  console.log(`Đã gom thành ${validSets.length} sets lớp hợp lệ (đã bao gồm lớp kèm và gom tất cả các buổi học/tuần).`);

  // Hàm check trùng lịch
  function isConflict(setA: ClassSet, setB: ClassSet): boolean {
    for (const a of setA.sections) {
      for (const b of setB.sections) {
        // Bỏ qua check nếu cùng mã lớp (hiếm khi xảy ra giữa 2 set khác nhau nhưng cứ để cho an toàn)
        if (a.sectionCode === b.sectionCode) continue;

        if (!a.dayOfWeek || !b.dayOfWeek || !a.timeOfDay || !b.timeOfDay) continue;
        if (a.dayOfWeek === b.dayOfWeek && a.timeOfDay === b.timeOfDay) {
          const aStart = a.startPeriod ?? 1;
          const aEnd = a.endPeriod ?? 12;
          const bStart = b.startPeriod ?? 1;
          const bEnd = b.endPeriod ?? 12;

          // Check overlap
          if (Math.max(aStart, bStart) <= Math.min(aEnd, bEnd)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Double check internal conflict trong chính Set (giữa lớp LT và lớp bài tập)
  const finalValidSets = validSets.filter(set => !isConflict(set, set));
  console.log(`Sau khi lọc trùng lịch nội bộ, còn lại ${finalValidSets.length} sets.`);

  // 4. Tạo các Batch
  const numBatches = 100;
  const coursesPerBatch = 4;
  const batches: string[][] = [];

  const shuffledSets = [...finalValidSets].sort(() => 0.5 - Math.random());

  let setIndex = 0;

  for (let i = 0; i < numBatches; i++) {
    const currentBatchSets: ClassSet[] = [];
    const currentBatchCourseIds = new Set<string>();

    // Cố gắng tìm 4 môn học không trùng nhau cho batch này
    let attempts = 0;
    while (currentBatchSets.length < coursesPerBatch && attempts < validSets.length) {
      const candidate = shuffledSets[setIndex % shuffledSets.length];
      setIndex++;
      attempts++;

      // Cùng môn học -> bỏ qua
      if (currentBatchCourseIds.has(candidate.courseId)) continue;

      // Check trùng lịch với các set đã chọn trong batch
      const conflict = currentBatchSets.some(selected => isConflict(candidate, selected));
      if (!conflict) {
        currentBatchSets.push(candidate);
        currentBatchCourseIds.add(candidate.courseId);
      }
    }

    // Phẳng hoá các mã lớp từ các sets đã chọn và loại bỏ trùng lặp
    const batchCodes = [...new Set(currentBatchSets.flatMap(set => set.codes))];
    batches.push(batchCodes);
  }

  fs.writeFileSync('./scripts/k6/section-codes.json', JSON.stringify(batches, null, 2));
  console.log(`Đã tạo ${numBatches} batches. Mỗi batch có trung bình ${batches[0].length} mã lớp học phần (đã xử lý lớp lý thuyết/thí nghiệm và trùng lịch).`);
  console.log(`Ghi thành công vào scripts/k6/section-codes.json`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
