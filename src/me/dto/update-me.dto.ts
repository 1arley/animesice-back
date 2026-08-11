import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{3,20}$/, {
    message:
      'Apelido deve ter entre 3 e 20 caracteres e usar apenas letras minúsculas, números, _ ou -.',
  })
  userName?: string;
}
