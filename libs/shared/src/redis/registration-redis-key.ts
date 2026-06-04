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

  /** JSON — response lookup chính xác theo mã lớp trong kỳ — TTL 30 phút */
  sectionByCode: (semester: string, sectionCode: string) =>
    `reg:section:code:${semester}:${sectionCode}`,
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

/**
 * Redis key cho batch processing metrics — thay thế bảng batch_processing_logs.
 * Mỗi batch Worker ghi 1 Hash, TTL ngắn (2 phút). Dashboard đọc bằng SCAN + aggregate in-memory.
 * Convention: batch:log:{semester}:{batchId}
 */
export const BatchLogRedisKey = {
  /** Hash key cho 1 batch: fields = batchType, queueWaitMs, processingDurationMs,
   *  totalItems, successItems, failedItems, createdAtMs */
  entry: (semester: string, batchId: string) =>
    `batch:log:${semester}:${batchId}`,

  /** Glob pattern để SCAN tất cả log của 1 kỳ */
  pattern: (semester: string) => `batch:log:${semester}:*`,

  /** TTL mỗi entry (giây) — đủ cho window 10 phút + buffer */
  TTL_SECONDS: 600,
} as const;

