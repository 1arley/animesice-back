import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateExternalAnimeDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  coverImage?: string;
}
