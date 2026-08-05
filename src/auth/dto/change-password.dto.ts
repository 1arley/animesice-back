import { IsString, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'SenhaAtual123' })
  @IsString()
  @IsNotEmpty({ message: 'A senha atual não pode estar vazia.' })
  currentPassword!: string;

  @ApiProperty({ example: 'NovaSenha123', minLength: 8 })
  @IsString()
  @IsNotEmpty({ message: 'A nova senha não pode estar vazia.' })
  @MinLength(8, { message: 'A senha precisa ter no mínimo 8 caracteres.' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'A senha deve conter letras e números.',
  })
  newPassword!: string;
}
