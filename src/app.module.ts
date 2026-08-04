import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
