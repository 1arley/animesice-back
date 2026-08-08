import { Module } from '@nestjs/common';
import { UserAnimeListService } from '@/user-anime-list/user-anime-list.service';
import { UserAnimeListController } from '@/user-anime-list/user-anime-list.controller';
import { NotificationModule } from '@/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [UserAnimeListController],
  providers: [UserAnimeListService],
  exports: [UserAnimeListService],
})
export class UserAnimeListModule {}
