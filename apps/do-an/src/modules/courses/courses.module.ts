import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { CoursesHelperService } from './helpers/courses-helper.service';

@Module({
  controllers: [CoursesController],
  providers: [CoursesService, CoursesHelperService],
  exports: [CoursesService],
})
export class CoursesModule {}
