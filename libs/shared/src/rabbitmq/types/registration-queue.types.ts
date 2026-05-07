export enum RegistrationQueueEvent {
  CREATE_BATCH_REQUESTED = 'REGISTRATION_CREATE_BATCH_REQUESTED',
  CANCEL_BATCH_REQUESTED = 'REGISTRATION_CANCEL_BATCH_REQUESTED',
}

export type RegistrationBatchJobItem = {
  itemId: string;
  classSectionId: string;
};

export type CreateRegistrationBatchJobItem = RegistrationBatchJobItem & {
  courseId: string;
  courseCode: string;
  courseName: string;
  prerequisite: string | null;
  dayOfWeek: number | null;
  timeOfDay: string | null;
  startPeriod: number | null;
  endPeriod: number | null;
};

export type RegistrationBatchJobPayload =
  | {
      type: RegistrationQueueEvent.CREATE_BATCH_REQUESTED;
      batchId: string;
      userId: string;
      semester: string;
      items?: CreateRegistrationBatchJobItem[];
    }
  | {
      type: RegistrationQueueEvent.CANCEL_BATCH_REQUESTED;
      batchId: string;
      userId: string;
      semester: string;
      items?: RegistrationBatchJobItem[];
    };
