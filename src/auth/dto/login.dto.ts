import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail({}, { message: 'O email informado não é válido.' })
  @IsNotEmpty({ message: 'O email não pode estar vazio.' })
  email!: string;

  @ApiProperty({
    example: 'Senha@123',
    description: 'Senha do usuário',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: 'A senha não pode estar vazia.' })
  @MinLength(8, { message: 'A senha precisa ter no mínimo 8 caracteres.' })
  password!: string;

  @ApiProperty({
    example: '0x4AAAA...',
    description: 'Token do Turnstile (captcha) obtido no login.',
    required: false,
  })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}
