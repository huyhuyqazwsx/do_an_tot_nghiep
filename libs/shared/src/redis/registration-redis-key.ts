/**
 * Tất cả Redis key liên quan đến đăng ký tín chỉ.
 * Convention: reg:{domain}:{...ids}
 */
export const RegistrationRedisKey = {
  /** JSON: { id, semester, openAt, closeAt, slotIds[] } — TTL đến closeAt */
  session: (semester: string) => `reg:session:${semester}`,

  /** Set<userId> — SV được phép vào slot này — TTL đến slot.closeAt */
  slotAllowed: (slotId: string) => `reg:slot:allowed:${slotId}`,

  /** String (integer) — slot còn lại của lớp học phần */
  sectionSlots: (classSectionId: string) =>
    `reg:section:slots:${classSectionId}`,

  /** Hash — thông tin lịch học: dayOfWeek, timeOfDay, startPeriod, endPeriod... — TTL 1h */
  sectionInfo: (classSectionId: string) =>
    `reg:section:info:${classSectionId}`,

  /** Set<classSectionId> — các lớp đã đăng ký ACTIVE của user trong kỳ */
  userRegistered: (userId: string, semester: string) =>
    `reg:user:registered:${userId}:${semester}`,

  /** Set<"dayOfWeek:timeOfDay:startPeriod:endPeriod"> — lịch hiện tại để check trùng */
  userSchedule: (userId: string, semester: string) =>
    `reg:user:schedule:${userId}:${semester}`,

  /** String (gzip JSON) — toàn bộ TKB của kỳ */
  tkb: (semester: string) => `reg:tkb:${semester}`,

  /** String — version để FE check cache local */
  tkbVersion: (semester: string) => `reg:tkb:version:${semester}`,
} as const;
