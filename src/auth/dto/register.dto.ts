import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    example: 'john_doe',
    description:
      'Apelido único (3-20 chars, minúsculas, números, _ e -). Opcional — pode ser definido depois em /settings.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{3,20}$/, {
    message:
      'Apelido deve ter entre 3 e 20 caracteres e usar apenas letras minúsculas, números, _ ou -.',
  })
  userName?: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres' })
  password!: string;

  @ApiProperty({
    example: '0x4AAAA...',
    description: 'Token do Turnstile (captcha) obtido no cadastro.',
    required: false,
  })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}
