import { IsString, IsOptional, IsNotEmpty, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Novo Nome' })
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'O nome não pode estar vazio.' })
  name?: string;

  @ApiPropertyOptional({
    example: 'john_doe',
    description: 'Apelido único (3-20 chars, minúsculas, números, _ e -).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{3,20}$/, {
    message:
      'Apelido deve ter entre 3 e 20 caracteres e usar apenas letras minúsculas, números, _ ou -.',
  })
  userName?: string;
}
