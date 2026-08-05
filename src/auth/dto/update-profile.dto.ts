import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Novo Nome' })
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'O nome não pode estar vazio.' })
  name?: string;
}
