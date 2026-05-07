import { PartialType } from '@nestjs/swagger';
import { CreateRegistrationSessionDto } from './create-registration-session.dto';

export class UpdateRegistrationSessionDto extends PartialType(
  CreateRegistrationSessionDto,
) {}
