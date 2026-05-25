// ─── Schedule ─────────────────────────────────────────────────────────────────

/** Thông tin lịch học cơ bản để check trùng lịch */
export interface ScheduleInfo {
  dayOfWeek: number | null;
  timeOfDay: string | null;
  startPeriod: number | null;
  endPeriod: number | null;
}

// ─── Section info (dùng trong CreateBatchHandler) ─────────────────────────────

/** Thông tin lớp học phần đã được load từ DB hoặc từ payload */
export type CreateBatchSectionInfo = ScheduleInfo & {
  id: string;
  courseId: string;
  course: {
    code: string;
    name: string;
    prerequisite: string | null;
  };
};

/** Thông tin lịch + môn của đăng ký hiện có (để check trùng lịch / trùng môn) */
export type ExistingRegistrationInfo = ScheduleInfo & {
  courseId: string;
};
