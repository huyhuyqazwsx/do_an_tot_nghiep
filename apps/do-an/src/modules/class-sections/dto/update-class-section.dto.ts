import { PartialType } from '@nestjs/swagger';
import { CreateClassSectionDto } from './create-class-section.dto';

export class UpdateClassSectionDto extends PartialType(CreateClassSectionDto) {}
