# Graph Report - animesice-back  (2026-10-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3604 nodes · 9212 edges · 179 communities (117 shown, 62 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 488 edges (avg confidence: 0.85)
- Token cost: 9,425 input · 2,176 output

## Graph Freshness
- Built from commit: `8d1e3900`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Gacha Admin Services
- Gacha Admin Controller
- Room Socket Controller
- Gacha Data Transfer Objects
- Admin and AniList Services
- Authentication and Identity Service
- Project Configuration Files
- NestJS Application Modules
- Core Infrastructure and Utilities
- User and Settings Migrations
- Anime Search and Filtering
- NPM Scripts and Backfills
- Economy Logic and Rules
- Web Scraping and Extraction
- Comment Management Controller
- Gacha Value Backfill Script
- Source Extraction Health Monitor
- Authentication Guards
- Anime and Comment Migrations
- Economy and Market Controller
- User Registration and Profile
- Scraping and Cache Service
- User Reporting Controller
- Audit and Cache Interceptors
- Streaming and Extraction Controller
- Gacha Configuration Service
- User Profile Management
- Development Dependencies
- JWT Authentication Guards
- Blog Management Controller
- SSRF Security Utilities
- Crystal Purchase Management
- Public Economy Controller
- AniList GraphQL Client
- Admin Gacha Operations
- Anime Discovery Controller
- Community Feedback and Requests
- Prisma and Job Services
- User Anime List DTOs
- Role-Based Access Control
- User Progress Tracking
- Core Dependencies
- Crystal Accounting Service
- TypeScript Configuration
- Media Liveness Probing
- Economy Constants and Rules
- Catalog Scanning and Scheduling
- Anime Rating Controller
- Personalized Recommendations
- Authentication Controller
- Embed and Proxy Service
- Social Feed Controller
- JWT Refresh Strategy
- Notification Management
- User Settings Controller
- Watchtower Task Controller
- Rust Extraction Core
- Gacha Card Migrations
- Extraction Job Management
- Browser Proxy Pool
- System Metrics Monitoring
- Social Networking Service
- Schedule Synchronization Service
- Community Interaction Migrations
- Admin Content Management
- Embed Proxy Controller
- E2E Testing Environment
- End-to-End Integration Tests
- Admin Anime Service
- Account Verification DTOs
- Adult Catalog Sync
- Worker and Job Processing
- Event-Driven Media Extraction
- Favorites Management
- App Entry and Interceptors
- AniList Enrichment Script
- User Settings Service
- Feedback and Request Migrations
- Gacha Market Migrations
- Animefire Seeding Script
- MAL Status Sync
- Audit Logging Controller
- Genre Discovery Controller
- Moderation and Reporting Service
- Catalog Discovery Service
- Anime Database Seeding
- AniList Status Backfill
- Synopsis Enrichment Script
- Gacha Character Seeding
- Rate Limiting Guard
- Scraper Unit Tests
- Watchtower Task Scheduler
- Social and Follow Migrations
- Moderation Data Transfer Objects
- Global Exception Filter
- Anime Creation DTOs
- Gacha Trade Migrations
- Gacha Collection Migrations
- WebSocket Room Gateway
- App Core Controller
- Community Module
- Web Scraping Service
- Favorites Module
- Moderation Database Schema
- External Scraper Integration
- Database Connection Utility
- Settings Data Transfer Objects
- Social Post DTOs
- Room Database Schema
- Gacha Waifu Schema
- Gacha Wishlist Schema
- AniList ID Backfill
- Project Dependencies
- Watchlist Database Schema
- Watchtower Job Schema
- MAL Image Backfill
- Episode Management API
- History Loading DTO
- Build and Release Tools
- Anime Source Mapping
- Crystal Code Schema
- NestJS CLI Configuration
- Auth Token Schema
- Gacha Mechanics Schema
- NPM Package Metadata
- Anime Import DTO
- Email Change DTO
- Password Change DTO
- Profile Update DTO
- JWT Refresh Guard
- TTL Cache Utility
- Admin Audit Schema
- Blog Post Schema
- Stream Extraction Schema
- Gacha Admin Schema
- Gacha Rarity Schema
- Release Condition Scripts
- Profile Metadata DTO
- External Anime DTO
- Email Token Schema
- Password Reset Schema
- Email Verification Schema
- Gacha Card Customization
- TypeScript Configuration
- Source Backfill Script
- Verification Decorator
- Database Runner Script
- Project Directory Structure
- Repository Metadata
- Gacha Points Schema
- Gacha Configuration Schema
- AnimeFire Scraper

## God Nodes (most connected - your core abstractions)
1. `@nestjs/common` - 202 edges
2. `AuthenticatedRequest` - 194 edges
3. `"Post"` - 120 edges
4. `PrismaService` - 119 edges
5. `GachaService` - 113 edges
6. `GachaController` - 94 edges
7. `EconomyService` - 83 edges
8. `@prisma/client` - 80 edges
9. `Roles()` - 73 edges
10. `@nestjs/swagger` - 68 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `GachaService`  [EXTRACTED]
  test/crystal-reservation.check.ts → src/gacha/gacha.service.ts
- `main()` --calls--> `EconomyService`  [EXTRACTED]
  test/crystal-reservation.check.ts → src/gacha/economy/economy.service.ts
- `main()` --calls--> `EconomyService`  [EXTRACTED]
  test/gacha-economy.check.ts → src/gacha/economy/economy.service.ts
- `main()` --calls--> `GachaConfigService`  [EXTRACTED]
  test/crystal-economy.check.ts → src/gacha/gacha-config.service.ts
- `main()` --calls--> `GachaConfigService`  [EXTRACTED]
  test/crystal-reservation.check.ts → src/gacha/gacha-config.service.ts

## Import Cycles
- None detected.

## Communities (179 total, 62 thin omitted)

### Community 0 - "Gacha Admin Services"
Cohesion: 0.04
Nodes (8): featuredProductiveMs(), fmtTrade(), gachaPilotBucket(), GachaService, normalizeLoadout(), presentPull(), checkMigration(), main()

### Community 2 - "Room Socket Controller"
Cohesion: 0.05
Nodes (6): CreateRoomDto, RoomController, RoomGateway, RoomScheduler, RoomService, generateRoomSlug()

### Community 3 - "Gacha Data Transfer Objects"
Cohesion: 0.08
Nodes (28): ApplyGachaSkinDto, ApplyRankingDto, BurnGachaCardDto, BuyCosmeticDto, ClaimGachaDto, CreateCrystalCodeDto, CreateListingDto, EquipGachaSkinDto (+20 more)

### Community 4 - "Admin and AniList Services"
Cohesion: 0.06
Nodes (22): class-validator, ms, @nestjs/swagger, AniListCoverImage, AniListMedia, AniListTitle, GraphQLResponse, UpdateAnimeDto (+14 more)

### Community 5 - "Authentication and Identity Service"
Cohesion: 0.06
Nodes (8): resend, AuthService, LoginDto, RegisterDto, escapeHtml(), MailPayload, MailService, mockSend

### Community 6 - "Project Configuration Files"
Cohesion: 0.04
Nodes (57): author, bugs, url, description, homepage, keywords, license, main (+49 more)

### Community 7 - "NestJS Application Modules"
Cohesion: 0.07
Nodes (21): @nestjs/jwt, AdminModule, AnimeModule, AuthModule, CommentModule, EmbedModule, EpisodeModule, MailModule (+13 more)

### Community 8 - "Core Infrastructure and Utilities"
Cohesion: 0.07
Nodes (21): bcrypt, @nestjs/testing, @prisma/client, BCRYPT_ROUNDS, ROLE_HIERARCHY, PROFILE_PUBLIC_OR_EMPTY, GACHA_FOILS, GACHA_TIERS (+13 more)

### Community 9 - "User and Settings Migrations"
Cohesion: 0.06
Nodes (49): "User", User_email_key, User_userName_key, "PrivacySettings", "SiteSetting", "GachaRollDay", User_featuredUserCardId_key, "CrystalEvent" (+41 more)

### Community 10 - "Anime Search and Filtering"
Cohesion: 0.07
Nodes (26): AnimeFilterDto, buildWhere(), CARD_SELECT, FUZZY_THRESHOLD, LIST_SELECT, SortMode, build(), makePrisma() (+18 more)

### Community 11 - "NPM Scripts and Backfills"
Cohesion: 0.04
Nodes (53): scripts, backfill:anilist, backfill:anilist:dry, backfill:gacha-values, backfill:gacha-values:dry, backfill:meusanimes-sources, backfill:skin-images, backfill:skin-images:dry (+45 more)

### Community 12 - "Economy Logic and Rules"
Cohesion: 0.12
Nodes (6): EconomyConfig, dateFromDayKey(), dayKey(), PrizeQuality, weightedPick(), EconomyService

### Community 13 - "Web Scraping and Extraction"
Cohesion: 0.11
Nodes (24): playwright, AnimesdigitalScrapeSource, captureMediaRequests(), extractAllIframes(), ExtractDocument, extractEpisodeMedia(), extractVideoElements(), isExpiringMediaUrl() (+16 more)

### Community 14 - "Comment Management Controller"
Cohesion: 0.08
Nodes (8): CommentController, CommentService, sanitizeContent(), build(), makeNotificationService(), makePrisma(), CreateCommentDto, EditCommentDto

### Community 15 - "Gacha Value Backfill Script"
Cohesion: 0.08
Nodes (27): main(), parseArgs(), prisma, inactiveEventIds(), cardValue(), conditionLabel(), conditionMult(), GACHA_FOILS (+19 more)

### Community 16 - "Source Extraction Health Monitor"
Cohesion: 0.07
Nodes (16): Extractor, ExtractResult, HealthMonitor, SourceFailure, SourceScore, Publisher, ProbeStatus, SourceCandidate (+8 more)

### Community 17 - "Authentication Guards"
Cohesion: 0.08
Nodes (11): @nestjs/common, sanitize-html, OptionalJwtAuthGuard, VerifiedGuard, OptionalAuthRequest, BlogModule, BLOG_HTML_OPTIONS, RatingModule (+3 more)

### Community 18 - "Anime and Comment Migrations"
Cohesion: 0.08
Nodes (40): "Anime", Anime_slug_idx, Anime_slug_key, "_AnimeToGenre", _AnimeToGenre_AB_unique, _AnimeToGenre_B_index, "Comment", Comment_animeId_idx (+32 more)

### Community 20 - "User Registration and Profile"
Cohesion: 0.06
Nodes (3): CreateUserDto, UserController, UserService

### Community 21 - "Scraping and Cache Service"
Cohesion: 0.10
Nodes (5): dbg(), sanitizeLog(), ScrapeService, ScrapeSource, SourceFailureKind

### Community 22 - "User Reporting Controller"
Cohesion: 0.11
Nodes (5): ReportUserDto, UsersController, build(), makePrisma(), UsersService

### Community 23 - "Audit and Cache Interceptors"
Cohesion: 0.07
Nodes (8): rxjs, CatalogCacheInterceptor, AUDIT_KEY, AuditMetadata, AuditInterceptor, MaintenanceInterceptor, AuditLogInput, AuditService

### Community 24 - "Streaming and Extraction Controller"
Cohesion: 0.10
Nodes (6): ExtractionJob, clientIpFromRequest(), StreamingController, dbg(), StreamingService, wrapMediaUrl()

### Community 25 - "Gacha Configuration Service"
Cohesion: 0.08
Nodes (3): GachaConfigService, Row, rows

### Community 26 - "User Profile Management"
Cohesion: 0.09
Nodes (5): UpdateMeDto, MeController, MeService, build(), makePrisma()

### Community 27 - "Development Dependencies"
Cohesion: 0.05
Nodes (42): devDependencies, @commitlint/cli, @commitlint/config-conventional, dotenv, dotenv-cli, eslint, eslint-config-prettier, @eslint/eslintrc (+34 more)

### Community 28 - "JWT Authentication Guards"
Cohesion: 0.08
Nodes (14): @nestjs/config, IS_PUBLIC_KEY, JwtAuthGuard, BillingModule, LivePixCrystalWebhook, LivePixWebhookBody, CreateMessageResponse, LivePixCheckout (+6 more)

### Community 29 - "Blog Management Controller"
Cohesion: 0.08
Nodes (4): BlogController, BlogService, CreateBlogPostDto, UpdateBlogPostDto

### Community 30 - "SSRF Security Utilities"
Cohesion: 0.08
Nodes (27): undici, assertHostResolvesSafely(), bindBodyTimeout(), blockedNetworks, createSSRFDispatcher(), fetchSafeRaw(), isBlockedHostname(), isBlockedIp() (+19 more)

### Community 31 - "Crystal Purchase Management"
Cohesion: 0.07
Nodes (3): CrystalPurchaseController, CrystalPurchaseService, GachaBypassController

### Community 32 - "Public Economy Controller"
Cohesion: 0.14
Nodes (14): Public(), BuyBoxDto, CreateBuyOrderDto, CreateCardListingDto, CreateCrystalCheckoutDto, CreateMarketOfferDto, CreateSkinListingDto, EconomicEventDto (+6 more)

### Community 33 - "AniList GraphQL Client"
Cohesion: 0.08
Nodes (17): AiringEpisode, AniListCharacterSummary, AniListClient, AniListMediaSummary, GraphQLResponse, MediaScheduleSummary, sleep(), ReleaseMonitor (+9 more)

### Community 34 - "Admin Gacha Operations"
Cohesion: 0.13
Nodes (3): Audit(), Roles(), ModerationController

### Community 35 - "Anime Discovery Controller"
Cohesion: 0.15
Nodes (3): AnimeController, AnimeService, buildOrderBy()

### Community 36 - "Community Feedback and Requests"
Cohesion: 0.10
Nodes (3): CommunityController, CreateAnimeRequestDto, CreateSiteFeedbackDto

### Community 37 - "Prisma and Job Services"
Cohesion: 0.08
Nodes (6): PrismaService, MockPrismaClient, EnqueueInput, JobsService, RepairWorker, nextBackoffMs()

### Community 38 - "User Anime List DTOs"
Cohesion: 0.08
Nodes (5): UpdateUserAnimeListDto, UserAnimeListController, build(), makePrisma(), UserAnimeListService

### Community 39 - "Role-Based Access Control"
Cohesion: 0.10
Nodes (10): ROLES_KEY, RolesGuard, AvatarController, build(), ALLOWED_IMAGE_MIMETYPES, AvatarService, MAX_AVATAR_BYTES, build() (+2 more)

### Community 40 - "User Progress Tracking"
Cohesion: 0.09
Nodes (5): UpdateProgressDto, WatchHistoryController, build(), makePrisma(), WatchHistoryService

### Community 41 - "Core Dependencies"
Cohesion: 0.06
Nodes (33): dependencies, bcrypt, class-transformer, class-validator, cookie-parser, @libsql/client, ms, multer (+25 more)

### Community 42 - "Crystal Accounting Service"
Cohesion: 0.13
Nodes (4): CrystalAccountingService, main(), expectDayKey(), main()

### Community 43 - "TypeScript Configuration"
Cohesion: 0.06
Nodes (32): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, declarationMap, emitDecoratorMetadata, esModuleInterop, experimentalDecorators (+24 more)

### Community 44 - "Media Liveness Probing"
Cohesion: 0.11
Nodes (18): clearLivenessCache(), livenessCache, LivenessCacheEntry, livenessInflight, outboundFetch(), performMediaUrlProbe(), probeMediaUrlDead(), purgeExpiredLivenessCache() (+10 more)

### Community 45 - "Economy Constants and Rules"
Cohesion: 0.09
Nodes (25): ECONOMY_DEFAULTS, BOX_PRICE, BOX_TIERS, BOX_TOTAL_COST, BURN_PAYOUT, CARD_FLOOR, CATEGORY_WEIGHTS, CRYSTAL_PACKAGES (+17 more)

### Community 46 - "Catalog Scanning and Scheduling"
Cohesion: 0.09
Nodes (20): audioTypeFromTitle(), CatalogEntry, CatalogScan, EMPTY_SCAN, FakeEntry, configuredConcurrency, CONTROL_JOB_TYPES, CONTROL_TIMEOUT_MS (+12 more)

### Community 47 - "Anime Rating Controller"
Cohesion: 0.11
Nodes (3): RateAnimeDto, RatingController, RatingService

### Community 48 - "Personalized Recommendations"
Cohesion: 0.13
Nodes (6): RecommendationController, RecommendationModule, RecommendationService, build(), makePrisma(), vitrineFilter()

### Community 49 - "Authentication Controller"
Cohesion: 0.17
Nodes (3): "Post", AuthController, emailSendAllowed()

### Community 50 - "Embed and Proxy Service"
Cohesion: 0.13
Nodes (5): EmbedService, isPortAllowed(), outboundFetch(), createService(), mockedLookup

### Community 52 - "JWT Refresh Strategy"
Cohesion: 0.13
Nodes (8): @nestjs/passport, passport-jwt, JwtPayload, JwtRefreshStrategy, refreshCookieExtractor(), cookieExtractor(), JwtStrategy, hasActiveRestriction()

### Community 56 - "Rust Extraction Core"
Cohesion: 0.18
Nodes (12): bounded_text(), checked_url(), extract(), extract_animefire(), extract_meusanimes(), get(), host_allowed(), Input (+4 more)

### Community 57 - "Gacha Card Migrations"
Cohesion: 0.14
Nodes (18): "Card", Card_animeId_idx, Card_malCharacterId_key, Card_rarity_idx, "UserCard", UserCard_cardId_edition_idx, UserCard_userId_obtainedAt_idx, UserCard_userId_value_idx (+10 more)

### Community 58 - "Extraction Job Management"
Cohesion: 0.14
Nodes (5): @nestjs/schedule, ExtractionFn, ExtractionJobService, ExtractionJobStatus, Listener

### Community 59 - "Browser Proxy Pool"
Cohesion: 0.14
Nodes (9): playwrightProxy(), setupOutboundProxy(), mockedSetGlobalDispatcher, BrowserPool, ManagedContext, build(), makeBrowser(), makeContext() (+1 more)

### Community 60 - "System Metrics Monitoring"
Cohesion: 0.13
Nodes (3): MetricsController, MetricsService, MetricsSnapshot

### Community 62 - "Schedule Synchronization Service"
Cohesion: 0.12
Nodes (13): BACKFILL_BATCH, deriveFixedSlot(), fuzzyDate(), mapStatus(), SCHEDULE_ACTIVE_STATUSES, ScheduleSync, similarity(), SYNC_PAGE_DELAY_MS (+5 more)

### Community 63 - "Community Interaction Migrations"
Cohesion: 0.13
Nodes (19): "ChatMessage", ChatMessage_animeSlug_episodeNumber_createdAt_idx, ChatMessage_userId_idx, "CommentLike", CommentLike_commentId_idx, "Favorite", Favorite_animeId_idx, Favorite_userId_createdAt_idx (+11 more)

### Community 64 - "Admin Content Management"
Cohesion: 0.16
Nodes (3): AdminController, CreateGenreDto, UpdateEpisodeDto

### Community 66 - "E2E Testing Environment"
Cohesion: 0.18
Nodes (7): dotenv, displaySocket(), ensureXvfb(), isDisplayAlive(), waitForXvfb(), { execSync }, { existsSync }

### Community 67 - "End-to-End Integration Tests"
Cohesion: 0.21
Nodes (10): supertest, ErrorResponse, LoginResponse, RegisterResponse, UserResponse, createTestUser(), getApp(), getHttpServer() (+2 more)

### Community 68 - "Admin Anime Service"
Cohesion: 0.18
Nodes (3): build(), AdminService, AniListService

### Community 69 - "Account Verification DTOs"
Cohesion: 0.09
Nodes (3): ResetPasswordDto, VerifyEmailDto, SendMessageDto

### Community 70 - "Adult Catalog Sync"
Cohesion: 0.16
Nodes (4): AdultCatalogSyncService, mockSourceDisconnect, mockSourceFindMany, syncEnabled()

### Community 72 - "Event-Driven Media Extraction"
Cohesion: 0.21
Nodes (12): CheckDocument, CheckNodeList, checkVideoReady(), clickPlayButtons(), extractPlayerVideoEventDriven(), hasVideoMediaUrls(), isPlayableMediaUrl(), resolvePlayerToken() (+4 more)

### Community 74 - "App Entry and Interceptors"
Cohesion: 0.16
Nodes (8): cookie-parser, @nestjs/platform-socket.io, AppModule, BigIntSerializationInterceptor, LoggingInterceptor, assertSecrets(), bootstrap(), PLACEHOLDER_SECRETS

### Community 75 - "AniList Enrichment Script"
Cohesion: 0.28
Nodes (15): AniListMedia, cleanHtml(), enrichAnime(), fetchAniList(), isPlaceholderSynopsis(), main(), parseArgs(), prisma (+7 more)

### Community 77 - "Feedback and Request Migrations"
Cohesion: 0.22
Nodes (13): "AnimeRequest", AnimeRequest_status_createdAt_idx, AnimeRequest_title_idx, AnimeRequest_userId_idx, "AnimeRequestVote", AnimeRequestVote_userId_idx, "SiteFeedback", SiteFeedback_type_status_createdAt_idx (+5 more)

### Community 78 - "Gacha Market Migrations"
Cohesion: 0.24
Nodes (13): "GachaListing", GachaListing_status_expiresAt_idx, GachaListing_userCardId_key, GachaListing_userId_status_idx, "GachaMarketOffer", GachaMarketOffer_cardListingId_status_idx, GachaMarketOffer_offeredUserId_status_createdAt_idx, GachaMarketOffer_requestedUserId_status_createdAt_idx (+5 more)

### Community 79 - "Animefire Seeding Script"
Cohesion: 0.20
Nodes (13): AniListResult, AnimefireCatalogEntry, AnimefireEpisode, AnimefirePageInfo, fetchAnimefirePageInfo(), fetchSitemap(), groupBySlug(), main() (+5 more)

### Community 80 - "MAL Status Sync"
Cohesion: 0.21
Nodes (13): fetchJikan(), fetchMalOfficial(), JikanAnime, main(), malHeaders(), MalOfficialAnime, mapMalOfficialStatus(), mapStatus() (+5 more)

### Community 83 - "Moderation and Reporting Service"
Cohesion: 0.17
Nodes (4): ModerationService, build(), makeNotificationService(), makePrisma()

### Community 85 - "Anime Database Seeding"
Cohesion: 0.24
Nodes (12): ageRatingFromMal(), FALLBACK_ANIMES, fetchMAL(), fetchTopAnimes(), main(), MALAnime, prisma, sleep() (+4 more)

### Community 86 - "AniList Status Backfill"
Cohesion: 0.23
Nodes (12): AniListMedia, fetchMedia(), findMedia(), fuzzyDate(), main(), parseArgs(), prisma, RATE_LIMIT_BACKOFF (+4 more)

### Community 87 - "Synopsis Enrichment Script"
Cohesion: 0.25
Nodes (12): AniListDescription, bigramDice(), fetchMediaById(), isStrongTitleMatch(), isTemplateSynopsis(), lengthRatio(), main(), parseArgs() (+4 more)

### Community 88 - "Gacha Character Seeding"
Cohesion: 0.23
Nodes (13): characterName(), createPrismaClient(), imageOf(), main(), mal(), malAgent, MalAnimeHit, MalCharacterDetail (+5 more)

### Community 90 - "Rate Limiting Guard"
Cohesion: 0.23
Nodes (7): @nestjs/core, @nestjs/throttler, GuardUnderTest, makeGuard(), TrackRequest, ThrottlerBehindProxyGuard, TRUST_PROXY_ENABLED()

### Community 91 - "Scraper Unit Tests"
Cohesion: 0.28
Nodes (11): build(), ensureXvfbMock, FakeSource, launchMock, makeHealth(), makeMetrics(), makePageMock(), makePlaywrightSvc() (+3 more)

### Community 93 - "Social and Follow Migrations"
Cohesion: 0.24
Nodes (11): "Follow", Follow_followeeId_idx, Follow_followerId_idx, Post_status_createdAt_idx, Post_userId_createdAt_idx, "PostComment", PostComment_postId_createdAt_idx, PostComment_userId_idx (+3 more)

### Community 95 - "Moderation Data Transfer Objects"
Cohesion: 0.26
Nodes (3): CreateReportDto, ModerateUserDto, ResolveReportDto

### Community 96 - "Global Exception Filter"
Cohesion: 0.27
Nodes (5): bodyParserType(), HttpExceptionFilter, mapBodyParserError(), mapPrismaError(), prismaCode()

### Community 98 - "Gacha Trade Migrations"
Cohesion: 0.31
Nodes (9): "GachaTrade", GachaTrade_offeredUserCardId_key, GachaTrade_offeredUserId_status_idx, GachaTrade_requestedUserCardId_key, GachaTrade_requestedUserId_status_idx, "GachaTradeCard", GachaTradeCard_tradeId_side_position_key, GachaTradeCard_tradeId_userCardId_key (+1 more)

### Community 99 - "Gacha Collection Migrations"
Cohesion: 0.29
Nodes (9): "GachaCollection", GachaCollection_published_updatedAt_idx, GachaCollection_slug_key, "GachaCollectionMember", GachaCollectionMember_cardId_idx, "GachaCardDiscovery", GachaCardDiscovery_cardId_idx, "GachaCollectionProgress" (+1 more)

### Community 100 - "WebSocket Room Gateway"
Cohesion: 0.20
Nodes (6): @nestjs/websockets, socket.io, PlayerSyncState, RoomParticipant, authedSocket(), makeSocket()

### Community 102 - "Community Module"
Cohesion: 0.33
Nodes (4): CommunityModule, CommunityService, build(), makePrisma()

### Community 104 - "Favorites Module"
Cohesion: 0.33
Nodes (4): FavoriteModule, FavoriteService, build(), makePrisma()

### Community 106 - "Moderation Database Schema"
Cohesion: 0.31
Nodes (9): ChatMessage_status_idx, Comment_status_idx, "ModerationAction", ModerationAction_actionType_idx, ModerationAction_userId_createdAt_idx, "Report", Report_reporterId_idx, Report_status_createdAt_idx (+1 more)

### Community 107 - "External Scraper Integration"
Cohesion: 0.24
Nodes (5): runRustScraper(), RustScrapeResult, ctx, Events, spawnMock

### Community 108 - "Database Connection Utility"
Cohesion: 0.27
Nodes (7): pg, @prisma/adapter-pg, main(), prisma, probeHost(), createPrismaClient(), main()

### Community 109 - "Settings Data Transfer Objects"
Cohesion: 0.38
Nodes (4): ConfirmEmailChangeDto, UpdateNotificationPrefDto, UpdatePrivacyDto, UpdateSiteSettingsDto

### Community 111 - "Room Database Schema"
Cohesion: 0.42
Nodes (8): "Room", Room_animeSlug_episodeNumber_idx, Room_creatorId_idx, Room_expiresAt_idx, Room_slug_key, "RoomMessage", RoomMessage_roomId_createdAt_idx, RoomMessage_userId_idx

### Community 112 - "Gacha Waifu Schema"
Cohesion: 0.42
Nodes (8): "UserWaifu", UserWaifu_userId_obtainedAt_idx, UserWaifu_userId_value_idx, UserWaifu_waifuId_edition_idx, "Waifu", Waifu_anilistCharacterId_key, Waifu_animeId_idx, Waifu_rarity_idx

### Community 113 - "Gacha Wishlist Schema"
Cohesion: 0.39
Nodes (8): "GachaCardWishlist", GachaCardWishlist_cardId_priority_idx, GachaCardWishlist_userId_cardId_key, GachaCardWishlist_userId_priority_idx, "GachaSetWishlist", GachaSetWishlist_animeId_priority_idx, GachaSetWishlist_userId_animeId_key, GachaSetWishlist_userId_priority_idx

### Community 114 - "AniList ID Backfill"
Cohesion: 0.33
Nodes (7): AniListMedia, main(), parseArgs(), prisma, searchAniList(), similarity(), sleep()

### Community 115 - "Project Dependencies"
Cohesion: 0.25
Nodes (8): allowScripts, bcrypt@6.0.0, @parcel/watcher@2.6.0, prisma@7.10.0, @prisma/engines@7.10.0, @scarf/scarf@1.4.0, sqlite3@6.0.1, unrs-resolver@1.12.2

### Community 116 - "Watchlist Database Schema"
Cohesion: 0.43
Nodes (7): "NotificationPreference", NotificationPreference_userId_idx, NotificationPreference_userId_typeId_channel_key, "UserAnimeList", UserAnimeList_animeId_idx, UserAnimeList_userId_status_idx, UserAnimeList_userId_updatedAt_idx

### Community 117 - "Watchtower Job Schema"
Cohesion: 0.39
Nodes (7): Anime_anilistId_key, "WatchtowerJob", WatchtowerJob_status_nextRunAt_priority_idx, WatchtowerJob_type_dedupeKey_key, WatchtowerJob_type_status_idx, "WatchtowerSourceHealth", WatchtowerSourceHealth_disabled_idx

### Community 118 - "MAL Image Backfill"
Cohesion: 0.39
Nodes (7): createPrismaClient(), main(), malAgent, MALCharacterPictures, malHeaders(), sameImage(), sleep()

### Community 121 - "Build and Release Tools"
Cohesion: 0.29
Nodes (7): overrides, deepmerge-ts, js-yaml, multer, mysql2, semantic-release, @semantic-release/npm

### Community 122 - "Anime Source Mapping"
Cohesion: 0.48
Nodes (6): "AnimeSource", AnimeSource_animeId_sourceId_key, AnimeSource_sourceId_externalKey_idx, "EpisodeSource", EpisodeSource_episodeId_sourceId_key, EpisodeSource_sourceId_externalKey_idx

### Community 123 - "Crystal Code Schema"
Cohesion: 0.48
Nodes (6): "CrystalCode", CrystalCode_active_expiresAt_idx, CrystalCode_code_key, "CrystalCodeRedemption", CrystalCodeRedemption_codeId_userId_key, CrystalCodeRedemption_userId_createdAt_idx

### Community 124 - "NestJS CLI Configuration"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 125 - "Auth Token Schema"
Cohesion: 0.47
Nodes (4): "RefreshToken", RefreshToken_token_key, RefreshToken_userId_idx, RefreshToken_family_idx

### Community 126 - "Gacha Mechanics Schema"
Cohesion: 0.47
Nodes (5): "GachaBypass", GachaBypass_userId_status_idx, "GachaClaimLock", "GachaSpin", GachaSpin_userId_createdAt_idx

### Community 127 - "NPM Package Metadata"
Cohesion: 0.33
Nodes (5): exports, name, private, type, version

### Community 134 - "Admin Audit Schema"
Cohesion: 0.70
Nodes (4): "AdminAuditLog", AdminAuditLog_action_createdAt_idx, AdminAuditLog_adminId_createdAt_idx, AdminAuditLog_resourceType_idx

### Community 135 - "Blog Post Schema"
Cohesion: 0.70
Nodes (4): "BlogPost", BlogPost_createdAt_idx, BlogPost_published_publishedAt_idx, BlogPost_slug_key

### Community 136 - "Stream Extraction Schema"
Cohesion: 0.70
Nodes (4): "StreamExtractionJob", StreamExtractionJob_activeKey_key, StreamExtractionJob_animeSlug_episodeNumber_season_status_idx, StreamExtractionJob_status_lockedUntil_idx

### Community 137 - "Gacha Admin Schema"
Cohesion: 0.70
Nodes (4): "GachaAdminChange", GachaAdminChange_adminId_createdAt_idx, GachaAdminChange_cardId_createdAt_idx, GachaAdminChange_userCardId_createdAt_idx

### Community 138 - "Gacha Rarity Schema"
Cohesion: 0.70
Nodes (4): "GachaRarity", GachaRarity_active_dropWeight_idx, GachaRarity_name_key, GachaRarity_slug_key

### Community 142 - "Email Token Schema"
Cohesion: 0.83
Nodes (3): "EmailChangeToken", EmailChangeToken_token_key, EmailChangeToken_userId_idx

### Community 143 - "Password Reset Schema"
Cohesion: 0.83
Nodes (3): "PasswordResetToken", PasswordResetToken_token_key, PasswordResetToken_userId_idx

### Community 144 - "Email Verification Schema"
Cohesion: 0.83
Nodes (3): "EmailVerificationCode", EmailVerificationCode_codeHash_key, EmailVerificationCode_userId_idx

### Community 145 - "Gacha Card Customization"
Cohesion: 0.83
Nodes (3): "GachaCardBack", GachaCardBack_key_key, GachaCardBack_status_updatedAt_idx

### Community 146 - "TypeScript Configuration"
Cohesion: 0.50
Nodes (3): ./tsconfig.json, exclude, extends

### Community 149 - "Database Runner Script"
Cohesion: 0.67
Nodes (3): main(), prisma, run()

### Community 150 - "Project Directory Structure"
Cohesion: 0.67
Nodes (3): directories, doc, test

### Community 151 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **427 isolated node(s):** `SortMode`, `SyncCursor`, `PlayerSyncState`, `RoomParticipant`, `RustScrapeResult` (+422 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 1024 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **62 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@nestjs/common` connect `Authentication Guards` to `Room Socket Controller`, `Gacha Data Transfer Objects`, `Admin and AniList Services`, `Authentication and Identity Service`, `Project Configuration Files`, `NestJS Application Modules`, `Core Infrastructure and Utilities`, `Anime Search and Filtering`, `Web Scraping and Extraction`, `Comment Management Controller`, `Gacha Value Backfill Script`, `Source Extraction Health Monitor`, `Verification Decorator`, `User Reporting Controller`, `Audit and Cache Interceptors`, `Streaming and Extraction Controller`, `User Profile Management`, `JWT Authentication Guards`, `SSRF Security Utilities`, `Crystal Purchase Management`, `Public Economy Controller`, `AniList GraphQL Client`, `Prisma and Job Services`, `User Anime List DTOs`, `Role-Based Access Control`, `User Progress Tracking`, `Media Liveness Probing`, `Economy Constants and Rules`, `Catalog Scanning and Scheduling`, `Personalized Recommendations`, `Embed and Proxy Service`, `JWT Refresh Strategy`, `Extraction Job Management`, `Browser Proxy Pool`, `System Metrics Monitoring`, `Schedule Synchronization Service`, `End-to-End Integration Tests`, `App Entry and Interceptors`, `Moderation and Reporting Service`, `Rate Limiting Guard`, `Scraper Unit Tests`, `Global Exception Filter`, `App Core Controller`, `Community Module`, `Favorites Module`?**
  _High betweenness centrality (0.282) - this node is a cross-community bridge._
- **What connects `SortMode`, `SyncCursor`, `PlayerSyncState` to the rest of the system?**
  _427 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Gacha Admin Services` be split into smaller, more focused modules?**
  _Cohesion score 0.03870162297128589 - nodes in this community are weakly interconnected._
- **Why does `"Post"` connect `Authentication Controller` to `Gacha Admin Controller`, `Room Socket Controller`, `User and Settings Migrations`, `Economy Logic and Rules`, `Comment Management Controller`, `Anime and Comment Migrations`, `Economy and Market Controller`, `User Registration and Profile`, `User Reporting Controller`, `Crystal Purchase Management`, `AniList GraphQL Client`, `Admin Gacha Operations`, `Community Feedback and Requests`, `User Anime List DTOs`, `User Progress Tracking`, `Crystal Accounting Service`, `Anime Rating Controller`, `Social Feed Controller`, `User Settings Controller`, `Watchtower Task Controller`, `Admin Content Management`, `Favorites Management`, `Feedback and Request Migrations`, `Social and Follow Migrations`, `Episode Discovery Controller`?**
  _High betweenness centrality (0.153) - this node is a cross-community bridge._
- **Should `Gacha Admin Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.11235955056179775 - nodes in this community are weakly interconnected._
- **Why does `AuthenticatedRequest` connect `Gacha Admin Controller` to `Room Socket Controller`, `Gacha Data Transfer Objects`, `Admin and AniList Services`, `Core Infrastructure and Utilities`, `Anime Search and Filtering`, `Economy Logic and Rules`, `Comment Management Controller`, `Authentication Guards`, `Economy and Market Controller`, `User Registration and Profile`, `User Reporting Controller`, `Audit and Cache Interceptors`, `User Profile Management`, `JWT Authentication Guards`, `Crystal Purchase Management`, `Public Economy Controller`, `Admin Gacha Operations`, `Community Feedback and Requests`, `User Anime List DTOs`, `Role-Based Access Control`, `User Progress Tracking`, `Crystal Accounting Service`, `Anime Rating Controller`, `Personalized Recommendations`, `Authentication Controller`, `Social Feed Controller`, `Notification Management`, `User Settings Controller`, `Favorites Management`, `Community Module`, `Favorites Module`, `Admin Settings API`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Should `Room Socket Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.0532724505327245 - nodes in this community are weakly interconnected._