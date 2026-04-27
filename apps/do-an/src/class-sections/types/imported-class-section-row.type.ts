import {
  ClassSectionStatus,
  ClassSectionType,
  ClassTimeOfDay,
  SectionOpenGroup,
} from '@prisma/client';

export interface ImportedClassSectionRow {
  sectionCode: string;
  linkedSectionCode: string | null;
  courseId: string;
  semester: string;
  dayOfWeek: number | null;
  timeOfDay: ClassTimeOfDay | null;
  startPeriod: number | null;
  endPeriod: number | null;
  timeRange: string | null;
  weekRange: string | null;
  room: string | null;
  sectionType: ClassSectionType | null;
  openingGroup: SectionOpenGroup | null;
  sectionStatus: ClassSectionStatus | null;
  requiresLab: boolean;
  note: string | null;
  maxCapacity: number;
  registeredCount: number;
}
