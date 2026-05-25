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
