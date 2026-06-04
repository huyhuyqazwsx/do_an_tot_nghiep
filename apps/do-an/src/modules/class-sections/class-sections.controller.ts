import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Body,
  ParseUUIDPipe,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClassSectionsService } from './class-sections.service';
import type { UploadedCsvFile } from './types/uploaded-csv-file.type';
import { ClassSectionDetailResponseDto } from './dto/response/class-section-detail-response.dto';
import { ClassSectionImportResponseDto } from './dto/response/class-section-import-response.dto';
import { ClassSectionListResponseDto } from './dto/response/class-section-list-response.dto';
import { QueryClassSectionsDto } from './dto/query-class-sections.dto';
import { CreateClassSectionDto } from './dto/create-class-section.dto';
import { UpdateClassSectionDto } from './dto/update-class-section.dto';

@ApiTags('Class Sections')
@Controller('api/class-sections')
export class ClassSectionsController {
  constructor(private readonly classSectionsService: ClassSectionsService) {}

  @Post('import')
  @ApiOperation({ summary: 'Import class sections from schedule CSV file' })
  @ApiCreatedResponse({ type: ClassSectionImportResponseDto })
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
  @ApiOperation({ summary: 'Get class sections with pagination and filters' })
  @ApiOkResponse({ type: ClassSectionListResponseDto })
  findAll(@Query() query: QueryClassSectionsDto) {
    return this.classSectionsService.findAll(query);
  }

  @Get('by-code/:sectionCode')
  @ApiOperation({ summary: 'Lookup class sections by exact section code' })
  @ApiOkResponse({ type: ClassSectionListResponseDto })
  findBySectionCode(
    @Param('sectionCode') sectionCode: string,
    @Query('semester') semester: string,
  ) {
    return this.classSectionsService.findBySectionCode(semester, sectionCode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get class section details by id' })
  @ApiOkResponse({ type: ClassSectionDetailResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.classSectionsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a class section' })
  @ApiCreatedResponse({ type: ClassSectionDetailResponseDto })
  create(@Body() dto: CreateClassSectionDto) {
    return this.classSectionsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a class section by id' })
  @ApiOkResponse({ type: ClassSectionDetailResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassSectionDto,
  ) {
    return this.classSectionsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a class section by id' })
  @ApiOkResponse({ type: ClassSectionDetailResponseDto })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.classSectionsService.remove(id);
  }
}
