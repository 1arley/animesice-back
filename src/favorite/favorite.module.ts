import { Module } from '@nestjs/common';
import { FavoriteService } from '@/favorite/favorite.service';
import { FavoriteController } from '@/favorite/favorite.controller';

@Module({
  controllers: [FavoriteController],
  providers: [FavoriteService],
  exports: [FavoriteService],
})
export class FavoriteModule {}
