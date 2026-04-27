import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CoursesService } from './courses.service';
import { QueryCoursesDto } from './dto/query-courses.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import type { UploadedCsvFile } from './types/uploaded-csv-file.type';

@ApiTags('Courses')
@Controller('api/courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @ApiOperation({ summary: 'Get courses with pagination and query filters' })
  findAll(@Query() query: QueryCoursesDto) {
    return this.coursesService.findAll(query);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get course details by course code' })
  findOne(@Param('code') code: string) {
    return this.coursesService.findOne(code);
  }

  @Post()
  @ApiOperation({ summary: 'Create a course' })
  create(@Body() createCourseDto: CreateCourseDto) {
    return this.coursesService.create(createCourseDto);
  }

  @Patch(':code')
  @ApiOperation({ summary: 'Update a course by code' })
  update(
    @Param('code') code: string,
    @Body() updateCourseDto: UpdateCourseDto,
  ) {
    return this.coursesService.update(code, updateCourseDto);
  }

  @Delete(':code')
  @ApiOperation({ summary: 'Delete a course by code' })
  remove(@Param('code') code: string) {
    return this.coursesService.remove(code);
  }

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

    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are supported');
    }

    return this.coursesService.importCourses(file);
  }
}
