import { Module } from '@nestjs/common';
import { RoomGateway } from '@/room/room.gateway';
import { RoomService } from '@/room/room.service';
import { RoomController } from '@/room/room.controller';
import { RoomScheduler } from '@/room/room.scheduler';
import { JwtModule } from '@nestjs/jwt';
import { ModerationModule } from '@/moderation/moderation.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
    }),
    ModerationModule,
  ],
  controllers: [RoomController],
  providers: [RoomGateway, RoomService, RoomScheduler],
  exports: [RoomService],
})
export class RoomModule {}
