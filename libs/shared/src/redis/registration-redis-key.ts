/**
 * Tất cả Redis key liên quan đến đăng ký tín chỉ.
 * Convention: reg:{domain}:{...ids}
 */
export const RegistrationRedisKey = {
  /** JSON: { id, semester, openAt, closeAt, slotIds[] } — TTL 30 phút */
  session: (semester: string) => `reg:session:${semester}`,

  /** Set<userId> — SV được phép vào slot này — TTL 30 phút */
  slotAllowed: (slotId: string) => `reg:slot:allowed:${slotId}`,

  /** String (integer) — slot còn lại của lớp học phần — TTL 30 phút */
  sectionSlots: (classSectionId: string) =>
    `reg:section:slots:${classSectionId}`,

  /** Hash — thông tin lịch học: dayOfWeek, timeOfDay, startPeriod, endPeriod... — TTL 30 phút */
  sectionInfo: (classSectionId: string) => `reg:section:info:${classSectionId}`,
} as const;

/**
 * Tất cả Redis key liên quan đến danh mục môn học.
 * Convention: courses:{domain}:{hash}
 */
export const CourseRedisKey = {
  /** JSON: kết quả phân trang/filter/sort danh sách môn học — TTL 30 phút */
  list: (hash: string) => `courses:list:${hash}`,

  /** JSON: chi tiết một môn học theo mã môn — TTL 30 phút */
  one: (hash: string) => `courses:one:${hash}`,

  /** Pattern dùng để xóa cache courses khi có ghi dữ liệu */
  all: () => 'courses:*',
} as const;
