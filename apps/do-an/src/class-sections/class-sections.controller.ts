import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClassSectionsService } from './class-sections.service';
import type { UploadedCsvFile } from './types/uploaded-csv-file.type';

@ApiTags('Class Sections')
@Controller('api/class-sections')
export class ClassSectionsController {
  constructor(private readonly classSectionsService: ClassSectionsService) {}

  @Post('import')
  @ApiOperation({ summary: 'Import class sections from schedule CSV file' })
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
  importClassSections(@UploadedFile() file: UploadedCsvFile) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new BadRequestException('Only .csv files are supported');
    }

    return this.classSectionsService.importClassSections(file);
  }

  @Get()
  @ApiOperation({ summary: 'Get all class sections' })
  findAll() {
    return this.classSectionsService.findAll();
  }

  @Get(':sectionCode')
  @ApiOperation({ summary: 'Get class section details by section code' })
  findOne(@Param('sectionCode') sectionCode: string) {
    return this.classSectionsService.findOne(sectionCode);
  }
}
