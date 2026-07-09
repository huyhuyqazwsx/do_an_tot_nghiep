// ─── Events ──────────────────────────────────────────────────────────────────

export enum RegistrationQueueEvent {
  CREATE_BATCH_REQUESTED = 'REGISTRATION_CREATE_BATCH_REQUESTED',
  CANCEL_BATCH_REQUESTED = 'REGISTRATION_CANCEL_BATCH_REQUESTED',
}

/** Item tối thiểu chứa trong batch (dùng cho CANCEL) */
export type RegistrationBatchJobItem = {
  classSectionId: string;
};

/** Item cho CANCEL — kèm ID của item đăng ký gốc cần hủy */
export type CancelRegistrationBatchJobItem = {
  itemId: string;
  classSectionId: string;
  sourceItemId: string;
};

/** Item đầy đủ thông tin cho CREATE — kèm theo thông tin lịch và môn học */
export type CreateRegistrationBatchJobItem = {
  itemId: string;
  classSectionId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  prerequisite: string | null;
  dayOfWeek: number | null;
  timeOfDay: string | null;
  startPeriod: number | null;
  endPeriod: number | null;
  weekRange: string | null;
};

// ─── Job Payload ──────────────────────────────────────────────────────────────

export type CreateBatchJobPayload = {
  type: RegistrationQueueEvent.CREATE_BATCH_REQUESTED;
  batchId: string;
  userId: string;
  semester: string;
  queuedAt: string;
  items?: CreateRegistrationBatchJobItem[];
};

export type CancelBatchJobPayload = {
  type: RegistrationQueueEvent.CANCEL_BATCH_REQUESTED;
  batchId: string;
  userId: string;
  semester: string;
  queuedAt: string;
  items?: CancelRegistrationBatchJobItem[];
};

export type RegistrationBatchJobPayload =
  | CreateBatchJobPayload
  | CancelBatchJobPayload;
