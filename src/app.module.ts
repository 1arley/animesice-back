import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/auth/auth.module';
import { UserModule } from '@/user/user.module';
import { AnimeModule } from '@/anime/anime.module';
import { GenreModule } from '@/genre/genre.module';
import { StreamingModule } from '@/streaming/streaming.module';
import { EpisodeModule } from '@/episode/episode.module';
import { CommentModule } from '@/comment/comment.module';
import { AdminModule } from '@/admin/admin.module';
import { EmbedModule } from '@/embed/embed.module';
import { RatingModule } from '@/rating/rating.module';
import { FavoriteModule } from '@/favorite/favorite.module';
import { WatchHistoryModule } from '@/watch-history/watch-history.module';
import { NotificationModule } from '@/notification/notification.module';
import { RoomModule } from '@/room/room.module';
import { UserAnimeListModule } from '@/user-anime-list/user-anime-list.module';
import { ModerationModule } from '@/moderation/moderation.module';
import { RecommendationModule } from '@/recommendation/recommendation.module';
import { CommunityModule } from '@/community/community.module';
import { WatchtowerModule } from '@/watchtower/watchtower.module';
import { MeModule } from '@/me/me.module';
import { UsersModule } from '@/users/users.module';
import { SettingsModule } from '@/settings/settings.module';
import { AuditService } from '@/common/services/audit.service';
import { AuditInterceptor } from '@/common/interceptors/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [
        '.env',
        '.env.local',
        ...(process.env.ENV_TEST ? [process.env.ENV_TEST] : []),
      ],
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: Number(process.env.THROTTLE_TTL ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      },
    ]),
    PrismaModule,
    AuthModule,
    UserModule,
    AnimeModule,
    GenreModule,
    StreamingModule,
    EpisodeModule,
    CommentModule,
    AdminModule,
    EmbedModule,
    RatingModule,
    FavoriteModule,
    WatchHistoryModule,
    NotificationModule,
    RoomModule,
    UserAnimeListModule,
    ModerationModule,
    RecommendationModule,
    CommunityModule,
    ScheduleModule.forRoot(),
    WatchtowerModule,
    MeModule,
    UsersModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AuditService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
