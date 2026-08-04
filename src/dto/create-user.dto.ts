import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  Matches,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({
    example: 'João Silva',
    description: 'Nome completo do usuário',
  })
  @IsString()
  @IsNotEmpty({ message: 'O nome não pode estar vazio.' })
  name?: string;

  @ApiProperty({
    example: 'joao@animesice.com',
    description: 'Email institucional do usuário',
  })
  @IsEmail({}, { message: 'O email informado não é válido.' })
  @IsNotEmpty({ message: 'O email não pode estar vazio.' })
  email!: string;

  @ApiProperty({
    example: 'Senha@123',
    description: 'Senha do usuário (mínimo 8 caracteres)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter no mínimo 8 caracteres.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'A senha deve conter letras e números.',
  })
  password!: string;

  @ApiPropertyOptional({
    example: 'USER',
    enum: Role,
    description: 'Role do usuário dentro do sistema',
    default: Role.USER,
  })
  @IsOptional()
  @IsEnum(Role, { message: 'Role inválida.' })
  role?: Role;
}
