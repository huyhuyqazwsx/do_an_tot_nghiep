import { Module } from '@nestjs/common';
import { ClassSectionsController } from './class-sections.controller';
import { ClassSectionsService } from './class-sections.service';

@Module({
  controllers: [ClassSectionsController],
  providers: [ClassSectionsService],
  exports: [ClassSectionsService],
})
export class ClassSectionsModule {}
