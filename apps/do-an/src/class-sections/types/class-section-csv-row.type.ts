import { IsNotEmpty, IsString, Matches, ValidateIf } from 'class-validator';

export class ClassSectionCsvRow {
  @IsString()
  @IsNotEmpty()
  semester: string;

  @IsString()
  @IsNotEmpty()
  sectionCode: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  linkedSectionCode?: string;

  @IsString()
  @IsNotEmpty()
  courseCode: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  note?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Matches(/^\d+$/, { message: 'dayOfWeek must be an integer string' })
  dayOfWeek?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  timeRange?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Matches(/^\d+$/, { message: 'startPeriod must be an integer string' })
  startPeriod?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Matches(/^\d+$/, { message: 'endPeriod must be an integer string' })
  endPeriod?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  timeOfDay?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  weekRange?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  room?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  requiresLab?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Matches(/^\d+$/, {
    message: 'registeredCount must be an integer string',
  })
  registeredCount?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  @Matches(/^\d+$/, { message: 'maxCapacity must be an integer string' })
  maxCapacity?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  sectionStatus?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  sectionType?: string;

  @ValidateIf((_object, value) => value !== '')
  @IsString()
  openingGroup?: string;
}
