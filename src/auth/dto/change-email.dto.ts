import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeEmailDto {
  @ApiProperty({ example: 'novo@email.com' })
  @IsEmail({}, { message: 'O email informado não é válido.' })
  @IsNotEmpty({ message: 'O email não pode estar vazio.' })
  newEmail!: string;
}
