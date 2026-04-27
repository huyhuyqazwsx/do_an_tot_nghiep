import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CoursesService } from './courses.service';
import type { UploadedCsvFile } from './types/uploaded-csv-file.type';

@ApiTags('Courses')
@Controller('api/courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post('import')
  @ApiOperation({ summary: 'Import courses from CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  importCourses(@UploadedFile() file: UploadedCsvFile) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    if (!this.isCsvFile(file)) {
      throw new BadRequestException('Only .csv files are supported');
    }

    return this.coursesService.importCourses(file);
  }

  private isCsvFile(file: UploadedCsvFile) {
    return file.originalname.toLowerCase().endsWith('.csv');
  }
}
