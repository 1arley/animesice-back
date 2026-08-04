import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class EmbedProxyDto {
  @ApiProperty({
    example: 'https://animefire.io/anime/xxx/tudo',
    description: 'URL da página que será embedada em iframe (proxy HTML).',
  })
  @IsString()
  @IsNotEmpty()
  url!: string;
}
