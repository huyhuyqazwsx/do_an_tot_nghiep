import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClassSectionsService } from './class-sections.service';

@ApiTags('Class Sections')
@Controller('api/class-sections')
export class ClassSectionsController {
  constructor(private readonly classSectionsService: ClassSectionsService) {}

  @Post('import')
  @ApiOperation({ summary: 'Import class sections from schedule CSV file' })
  importClassSections() {
    return this.classSectionsService.importClassSections();
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
