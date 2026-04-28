export interface ImportedCourseRow {
  code: string;
  name: string;
  englishName: string | null;
  credits: number;
  tuitionCredits: number | null;
  courseLoad: string | null;
  department: string | null;
  prerequisite: string | null;
  weight: number;
}
