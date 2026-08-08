import { Module } from '@nestjs/common';
import { RatingService } from '@/rating/rating.service';
import { RatingController } from '@/rating/rating.controller';

@Module({
  controllers: [RatingController],
  providers: [RatingService],
  exports: [RatingService],
})
export class RatingModule {}
