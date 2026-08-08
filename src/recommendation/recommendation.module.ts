import { Module } from '@nestjs/common';
import { RecommendationService } from '@/recommendation/recommendation.service';
import { RecommendationController } from '@/recommendation/recommendation.controller';

@Module({
  controllers: [RecommendationController],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class RecommendationModule {}
