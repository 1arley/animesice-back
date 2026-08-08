import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RoomService } from '@/room/room.service';

@Injectable()
export class RoomScheduler {
  private readonly logger = new Logger(RoomScheduler.name);

  constructor(private readonly roomService: RoomService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredRooms() {
    const count = await this.roomService.cleanupExpiredRooms();
    if (count > 0) {
      this.logger.log(`Removidas ${count} salas expiradas.`);
    }
  }
}
