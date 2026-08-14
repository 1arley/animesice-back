# [1.17.0](https://github.com/1arley/animesice-back/compare/v1.16.1...v1.17.0) (2026-08-14)


### Features

* **room:** sync de player em tempo real via socket.io ([e8dacdd](https://github.com/1arley/animesice-back/commit/e8dacddc16c37d2e344bc084b8c9798de3122b74))

## [1.16.1](https://github.com/1arley/animesice-back/compare/v1.16.0...v1.16.1) (2026-08-13)


### Bug Fixes

* **watchtower:** reextrair com embedUrl real no repair de episódios ([7e4bae1](https://github.com/1arley/animesice-back/commit/7e4bae115d20b04f63a547178a0c2deffb2b336d))

# [1.16.0](https://github.com/1arley/animesice-back/compare/v1.15.0...v1.16.0) (2026-08-13)


### Features

* **watchtower:** boost temporário de prioridade p/ animes selecionados ([4f861c0](https://github.com/1arley/animesice-back/commit/4f861c0afcfeff334158a4ecba9a21f62450279e))

# [1.15.0](https://github.com/1arley/animesice-back/compare/v1.14.0...v1.15.0) (2026-08-13)


### Bug Fixes

* **watchtower:** sincroniza status/endDate reais no sync de horários ([486975b](https://github.com/1arley/animesice-back/commit/486975b91e1ae8a5913bb807aec51bcc54191c72))


### Features

* **scripts:** backfill de status AniList p/ corrigir o catálogo ([4704fa5](https://github.com/1arley/animesice-back/commit/4704fa54103d83a5541b168f5e5a11574f5d5f33))
* **watchtower:** backfill anilistId/metadados + sync de horários fixos do calendário ([78f5709](https://github.com/1arley/animesice-back/commit/78f5709d5ddc94135b1346f0841483f9bb2b62eb))

# [1.14.0](https://github.com/1arley/animesice-back/compare/v1.13.0...v1.14.0) (2026-08-13)


### Features

* **admin:** endpoints de dashboard, gestão de usuários e moderação de posts ([2747b1d](https://github.com/1arley/animesice-back/commit/2747b1dee69e305550f628058314bdfe4de513a5))

# [1.13.0](https://github.com/1arley/animesice-back/compare/v1.12.1...v1.13.0) (2026-08-12)


### Bug Fixes

* **lint:** limpando warnings do eslint ([917d34c](https://github.com/1arley/animesice-back/commit/917d34c0b9e9b4bf1f08880ec82a866ea8833351))


### Features

* **social:** posts, follow e feed da comunidade ([621eac1](https://github.com/1arley/animesice-back/commit/621eac181f63c6f61114fa5016160643142dbeb2))

## [1.12.1](https://github.com/1arley/animesice-back/compare/v1.12.0...v1.12.1) (2026-08-12)


### Bug Fixes

* **watchtower:** prioridades, timeout por job e scanAll sem force ([24b058c](https://github.com/1arley/animesice-back/commit/24b058ca59c0f4c0fbb0d38c2e64912703c43a28))

# [1.12.0](https://github.com/1arley/animesice-back/compare/v1.11.0...v1.12.0) (2026-08-12)


### Features

* **observability:** add MetricsService counters with periodic log and cover embed/anime with specs ([e4e5d30](https://github.com/1arley/animesice-back/commit/e4e5d303b05c963b0034cc7c83dbe4cfddd6cdcc))
* **observability:** metrics endpoint + fuzzy e2e + CI migrate deploy ([4e6b9ee](https://github.com/1arley/animesice-back/commit/4e6b9ee332ace6622b3ed67775a0c460852a82db))
* **search:** fuzzy ranking via pg_trgm word_similarity with dry-run tool ([656072b](https://github.com/1arley/animesice-back/commit/656072b793e218ac5b6fa02db15e08e53a2c7fe4))

# [1.11.0](https://github.com/1arley/animesice-back/compare/v1.10.0...v1.11.0) (2026-08-12)


### Features

* **embed:** provider orchestration layer with health-aware source selection and SWR cache ([c0b0bf7](https://github.com/1arley/animesice-back/commit/c0b0bf7dffc52c61281fe6c45955cfd04e29bfa2))

# [1.10.0](https://github.com/1arley/animesice-back/compare/v1.9.0...v1.10.0) (2026-08-12)


### Features

* **back:** public activity feed and episodeCount in public collection ([66e759d](https://github.com/1arley/animesice-back/commit/66e759d4592591229e02ca7c32ffe21d3ffcc9c7))

# [1.9.0](https://github.com/1arley/animesice-back/compare/v1.8.0...v1.9.0) (2026-08-12)


### Features

* **back:** public user profiles under /users, privacy settings and myAnimeList ([fab7e97](https://github.com/1arley/animesice-back/commit/fab7e971d9555796345afe23ff6362f981ed2024))

# [1.8.0](https://github.com/1arley/animesice-back/compare/v1.7.6...v1.8.0) (2026-08-12)


### Bug Fixes

* **security:** close SSRF/token-exposure vectors, persist settings in DB, harden watchtower queue ([c18a6db](https://github.com/1arley/animesice-back/commit/c18a6dbd35bdce3d888e60a7e1161796f51d702a))


### Features

* **me,settings,users:** register me, settings, and users modules in app.module.ts ([6877a90](https://github.com/1arley/animesice-back/commit/6877a907de6b3dd5172b5dfef82698d493d22863))

## [1.7.6](https://github.com/1arley/animesice-back/compare/v1.7.5...v1.7.6) (2026-08-11)


### Bug Fixes

* **auth:** update password on re-register for unverified users ([e5aeb6b](https://github.com/1arley/animesice-back/commit/e5aeb6b3f5c400d14d62ded7bfc4d39b87e73189))

## [1.7.5](https://github.com/1arley/animesice-back/compare/v1.7.4...v1.7.5) (2026-08-11)


### Bug Fixes

* **watchtower:** narrow enqueue catch + bound 429 recursion + remove dead mock ([9236df4](https://github.com/1arley/animesice-back/commit/9236df48b7ba44034fbcfd60a48fe9eaae90ff3d))

## [1.7.4](https://github.com/1arley/animesice-back/compare/v1.7.3...v1.7.4) (2026-08-11)


### Bug Fixes

* **watchtower:** airingSchedules -> airingSchedule (AniList API change) ([#30](https://github.com/1arley/animesice-back/issues/30)) ([2415983](https://github.com/1arley/animesice-back/commit/24159833e47494b5c5eaf03f77544057b2fb1b8e))

## [1.7.3](https://github.com/1arley/animesice-back/compare/v1.7.2...v1.7.3) (2026-08-11)


### Bug Fixes

* **watchtower:** enqueue now resets DONE/DEAD jobs to PENDING ([#29](https://github.com/1arley/animesice-back/issues/29)) ([6945497](https://github.com/1arley/animesice-back/commit/69454971a81da273fd604e330a678ee0beebb043))

## [1.7.2](https://github.com/1arley/animesice-back/compare/v1.7.1...v1.7.2) (2026-08-11)


### Bug Fixes

* **watchtower:** post-split self-healing — URL pattern, scanner siblings, repair sweep, gap detection ([879ba03](https://github.com/1arley/animesice-back/commit/879ba034342fc64210c2ad04cab96935d2840a1b))


### Reverts

* **streaming:** fully revert 2041d21 googlevideo rejection ([83af4e2](https://github.com/1arley/animesice-back/commit/83af4e2b12417ed345054b3677251d4241948b3e))

## [1.7.1](https://github.com/1arley/animesice-back/compare/v1.7.0...v1.7.1) (2026-08-10)


### Bug Fixes

* **scrape:** restore googlevideo acceptance in watchtower extraction ([1c433de](https://github.com/1arley/animesice-back/commit/1c433de95dce69fef110ae2d22ef1a697c935a9e))

# [1.7.0](https://github.com/1arley/animesice-back/compare/v1.6.0...v1.7.0) (2026-08-10)


### Bug Fixes

* **lint:** remove unused imports and apply prettier formatting ([b945095](https://github.com/1arley/animesice-back/commit/b94509542c3d5704ff18c23298952b6ca942fd57))
* **streaming:** classify and reject googlevideo URLs from media proxy ([2041d21](https://github.com/1arley/animesice-back/commit/2041d218882b2cb4effb90f8208aaa91b2a9e215))


### Features

* **audit:** add admin audit log for sensitive data access ([086ca5d](https://github.com/1arley/animesice-back/commit/086ca5d8a264882b4cb49249ab06ac25393d28c1))

# [1.6.0](https://github.com/1arley/animesice-back/compare/v1.5.1...v1.6.0) (2026-08-10)


### Features

* **streaming:** serve YouTube embed sources as iframe ([522e3ca](https://github.com/1arley/animesice-back/commit/522e3ca2042c503dd44fed61e52243b4675fd4fb))

## [1.5.1](https://github.com/1arley/animesice-back/compare/v1.5.0...v1.5.1) (2026-08-10)


### Bug Fixes

* **scrape:** resolve YouTube player embeds from meusanimes get-video.php ([0d48fa8](https://github.com/1arley/animesice-back/commit/0d48fa86bf3d6138185a0149a0c099e629e8b2f1))

# [1.5.0](https://github.com/1arley/animesice-back/compare/v1.4.1...v1.5.0) (2026-08-10)


### Bug Fixes

* **streaming:** unblock playback of expired CDN URLs and multi-season extraction ([017bd2c](https://github.com/1arley/animesice-back/commit/017bd2c184f4b0509a9af09bbccd5c6802ff69c5))


### Features

* **schema:** add season column to Episode with multi-season support ([c937534](https://github.com/1arley/animesice-back/commit/c93753470eed91e379f86ad499a8928102e1f8ed))

## [1.4.1](https://github.com/1arley/animesice-back/compare/v1.4.0...v1.4.1) (2026-08-10)


### Bug Fixes

* **watchtower:** throw on catalog fetch failure ([ca8fb62](https://github.com/1arley/animesice-back/commit/ca8fb620c99cc9050f3548236a4298b8f629c087))

# [1.4.0](https://github.com/1arley/animesice-back/compare/v1.3.1...v1.4.0) (2026-08-10)


### Features

* **auth:** userName unico, avatar upload via Supabase S3, mail templates ([6e9ca5a](https://github.com/1arley/animesice-back/commit/6e9ca5a28132ab922a9273c75c728bc7d97f7204))

## [1.3.1](https://github.com/1arley/animesice-back/compare/v1.3.0...v1.3.1) (2026-08-10)


### Bug Fixes

* **auth:** set role cookie for middleware + skip Turnstile outside prod ([abdd935](https://github.com/1arley/animesice-back/commit/abdd9356ce07ced884f58a67efe53ae5efcdb0e3))
* **auth:** skip captcha with demo/empty Turnstile secret + clear role cookie on logout ([15cb879](https://github.com/1arley/animesice-back/commit/15cb8794c02f0914ff67f3f4036c701c241c51a5))

# [1.3.0](https://github.com/1arley/animesice-back/compare/v1.2.1...v1.3.0) (2026-08-10)


### Features

* add catalog scanner service ([436807b](https://github.com/1arley/animesice-back/commit/436807b6a438ecda9ab92f38e42255286388a2b2))
* improve streaming URL handling ([570b981](https://github.com/1arley/animesice-back/commit/570b9816b9fd762223b9eca533240492413c8bd9))

## [1.2.1](https://github.com/1arley/animesice-back/compare/v1.2.0...v1.2.1) (2026-08-09)


### Bug Fixes

* **deploy:** remove GHA Docker cache (quota exhausted) ([c037c8a](https://github.com/1arley/animesice-back/commit/c037c8a4463cdfba4713010ca91dcf2e610389cf))

# [1.2.0](https://github.com/1arley/animesice-back/compare/v1.1.5...v1.2.0) (2026-08-09)


### Features

* **watchtower:** autonomous anime release monitoring & episode extraction ([209d15b](https://github.com/1arley/animesice-back/commit/209d15b7054b7e73047f46d3ed9b217952723c80))

## [1.1.5](https://github.com/1arley/animesice-back/compare/v1.1.4...v1.1.5) (2026-08-09)


### Bug Fixes

* **admin:** harden HTML tag stripping in sanitizer ([96f291d](https://github.com/1arley/animesice-back/commit/96f291d4302f16b96084b16d945780808e549cb1))
* **auth:** rename unused param to satisfy lint ([3a5b450](https://github.com/1arley/animesice-back/commit/3a5b4502edecdf791ba9cb5431c2983472f0c32e))
* Clear text storage of sensitive information ([313fb4d](https://github.com/1arley/animesice-back/commit/313fb4d353c68db7f7f3059d9eca27d20580f153))
* **comment:** sanitize HTML with sanitize-html to close XSS bypass ([d776d0c](https://github.com/1arley/animesice-back/commit/d776d0ce11fb0077b3218bd48ab5030306db2973))
* **deps:** bump multer to 2.2.0 and patch js-yaml via override ([55b38e0](https://github.com/1arley/animesice-back/commit/55b38e007bfc63f6abae1ea4ca63821d713e3b34))
* **embed:** harden SSRF validation of outbound URLs ([6393433](https://github.com/1arley/animesice-back/commit/6393433363d3cedc767342b1fc749714518df97f))
* **embed:** sanitize log lines and drop file debug logger ([e091bc8](https://github.com/1arley/animesice-back/commit/e091bc8b1eeb30a9dfc69d7c5f56e3fa8d06cb97))
* **seed:** strip stray angle brackets from AniList description ([73267e4](https://github.com/1arley/animesice-back/commit/73267e4525a2b8d44b427946de3cdcf1bff54ee0))

## [1.1.4](https://github.com/1arley/animesice-back/compare/v1.1.3...v1.1.4) (2026-08-09)


### Bug Fixes

* **admin:** avoid ReDoS in slugify by using negative look-behind ([f3d7b14](https://github.com/1arley/animesice-back/commit/f3d7b144bf8e377b803e3de8680f8ec66cb57fdf))

## [1.1.3](https://github.com/1arley/animesice-back/compare/v1.1.2...v1.1.3) (2026-08-09)


### Bug Fixes

* Server-side request forgery ([40668ca](https://github.com/1arley/animesice-back/commit/40668cafd23b4e6dc72e67d586635e97baa4eb66))

## [1.1.2](https://github.com/1arley/animesice-back/compare/v1.1.1...v1.1.2) (2026-08-09)


### Bug Fixes

* **back:** verify Turnstile token on register ([d5bd95f](https://github.com/1arley/animesice-back/commit/d5bd95f50b8033601141fe964092b96df289d102))
* Server-side request forgery ([e14f8e6](https://github.com/1arley/animesice-back/commit/e14f8e6b766a273748c4f2d8a95483c9b853bd95))

## [1.1.1](https://github.com/1arley/animesice-back/compare/v1.1.0...v1.1.1) (2026-08-09)


### Bug Fixes

* **back:** add search to admin anime list + raise limit cap ([0ca5249](https://github.com/1arley/animesice-back/commit/0ca524914638d45a187c6bae7face0c9ee9cf874))

# [1.1.0](https://github.com/1arley/animesice-back/compare/v1.0.5...v1.1.0) (2026-08-08)


### Bug Fixes

* **episode:** remove dateModified not-null filter from latest query ([85b747d](https://github.com/1arley/animesice-back/commit/85b747d9021711faf3e82dd39eee2d174416ab0a))
* **turnstile:** fix TS build errors — cast json() and accept undefined token ([3e0a781](https://github.com/1arley/animesice-back/commit/3e0a781f1618b80a31dfb2e7aae0141d059afe04))


### Features

* **auth:** add Cloudflare Turnstile verify on login ([031fcdb](https://github.com/1arley/animesice-back/commit/031fcdbab033730185591ed9b5565b1d48cd1ebe))

## [1.0.5](https://github.com/1arley/animesice-back/compare/v1.0.4...v1.0.5) (2026-08-08)


### Bug Fixes

* **scrape:** resolve movie/single episodes from meusanimes ([2ae8119](https://github.com/1arley/animesice-back/commit/2ae8119d0ee42b73c5c11e0b907a0a7d58870b19))

## [1.0.4](https://github.com/1arley/animesice-back/compare/v1.0.3...v1.0.4) (2026-08-08)


### Bug Fixes

* **streaming:** probe stored media URL and auto re-extract when dead in getSource ([78cc3e8](https://github.com/1arley/animesice-back/commit/78cc3e8c78eb0c653a59b0a1cd9b29ac8cafffad))

## [1.0.3](https://github.com/1arley/animesice-back/compare/v1.0.2...v1.0.3) (2026-08-08)


### Bug Fixes

* **ci:** provide GH_TOKEN to gh in tag resolution step ([bd8e21a](https://github.com/1arley/animesice-back/commit/bd8e21a6f5d560757937dbfe1771cb6d59a2a650))

## [1.0.2](https://github.com/1arley/animesice-back/compare/v1.0.1...v1.0.2) (2026-08-08)


### Bug Fixes

* **ci:** resolve release tag via API and isolate deploy cache scope ([8707f06](https://github.com/1arley/animesice-back/commit/8707f06ecceb0da7125538285c0dfd0a77772811))

## [1.0.1](https://github.com/1arley/animesice-back/compare/v1.0.0...v1.0.1) (2026-08-08)


### Bug Fixes

* **ci:** trigger deploy after semantic-release completes ([3990148](https://github.com/1arley/animesice-back/commit/3990148bc545cedd3743e959659d52617607e3a6))

# 1.0.0 (2026-08-08)


### Bug Fixes

* clamp pagination limits and validate numeric episode params ([521127c](https://github.com/1arley/animesice-back/commit/521127c330d898082249a748e22cf02aae81e866))
* drop dotenv import from prisma config for prod image ([49fadff](https://github.com/1arley/animesice-back/commit/49fadff6bc753d04fb58b801fe682d0a85593a40))
* fail fast on placeholder jwt secrets and disable cors without explicit origins ([7e2014c](https://github.com/1arley/animesice-back/commit/7e2014c3ff2b294de3ca36b5c9229d5c5162fcba))
* gate x-forwarded headers behind trust proxy and honor public backend url ([5cbc6fa](https://github.com/1arley/animesice-back/commit/5cbc6faa8bee58db9693d11a96335aa690f2e01e))
* harden auth with hashed tokens, password-verified email change and cookie flags ([8975fda](https://github.com/1arley/animesice-back/commit/8975fdac431a1639840ead71d467aeaa691d2f11))
* log uncaught exceptions on http filter ([2cbcb15](https://github.com/1arley/animesice-back/commit/2cbcb1511116129ce8590d2c16a586d4e3be90cf))
* strip query strings from logs to avoid leaking tokens ([2e7f879](https://github.com/1arley/animesice-back/commit/2e7f879209066ec4047e9794b0c9431cb70a207e))
* **test:** e2e auth com mock de mail e fluxo de registro atualizado ([2fc4e93](https://github.com/1arley/animesice-back/commit/2fc4e93fb02fa0fe9de0eabba0f3863b360f7ef3))
* validate uploads by magic bytes and strip HTML from external text ([4758e28](https://github.com/1arley/animesice-back/commit/4758e28a9e02100696ef0d11e0eb2aaf8f1ac591))


### Features

* add email verification flow with Cloudflare Worker mailer ([45aa2cc](https://github.com/1arley/animesice-back/commit/45aa2cc3e4a6c2da51bb4e4a1b14b039109e4039))
* add global rate limiting with @nestjs/throttler ([a60678d](https://github.com/1arley/animesice-back/commit/a60678d7a93c9ec2489d12472ebb50c640e2c2d8))
* add password reset flow and harden scrape extraction ([3f8d54c](https://github.com/1arley/animesice-back/commit/3f8d54c33abf9b129c8b26077506f5f753dfed25))
* animefire catalog seed with anilist enrichment ([599ba02](https://github.com/1arley/animesice-back/commit/599ba02f1dbf94d96cea21c4e8012925f8a86fbd))
* **anime:** modelo enriquecido, schedule e filtros (anilist) ([9b81083](https://github.com/1arley/animesice-back/commit/9b8108350a105c8ea7f6e7de020914dbc08003a8))
* **auth:** login de contas não verificadas + VerifiedGuard p/ ações interativas ([a7a8170](https://github.com/1arley/animesice-back/commit/a7a81701fb29147c0f3662fdfcacc67ab25fa859))
* **comment:** likes, edição e status de comentários ([1c591b0](https://github.com/1arley/animesice-back/commit/1c591b0391226defa6e53f3bc2940de6d0fd37cb))
* **community:** pedidos de animes e feedback do site ([faef915](https://github.com/1arley/animesice-back/commit/faef915c7274223a16042f32e8771ef23c080f7c))
* cookie-based auth and account settings ([12a55d5](https://github.com/1arley/animesice-back/commit/12a55d55e8176253ed82f2627631a6c6ca5bc250))
* **embed:** proxy outbound e scraping com xvfb ([35530b5](https://github.com/1arley/animesice-back/commit/35530b5a766a9ce06eb720672ae4be51dc4b9abd))
* **favorite:** favoritos do usuário ([3ce7027](https://github.com/1arley/animesice-back/commit/3ce70278d2f934f59553c1e65d701873a88e29ec))
* harden media/embed proxy against SSRF and XSS ([6ecca34](https://github.com/1arley/animesice-back/commit/6ecca3457cf52ae79ed775fdc9778ff210436b19))
* **mail:** add CF Access service token headers to mail service ([12a5212](https://github.com/1arley/animesice-back/commit/12a5212243c78cabfad957c0affccada23074869))
* **mail:** resend API no lugar do Cloudflare Worker ([58203fe](https://github.com/1arley/animesice-back/commit/58203fe103f7b151b81ae45086f1803ba1bbf4e4))
* **moderation:** pipeline de moderação social ([8d5e39b](https://github.com/1arley/animesice-back/commit/8d5e39bf62822c2b96ad94520aff30851f39b046))
* multi-source scraping and media proxy with anti-hotlinking ([dd38757](https://github.com/1arley/animesice-back/commit/dd38757e2bf55259d56fb56392ef794c9685b4b7))
* **notification:** notificações e preferências ([4f344ff](https://github.com/1arley/animesice-back/commit/4f344ff042e2be71aaf05e161c6ecaa88a91dd4f))
* paginate comments with XSS sanitization and reply caps ([b576aed](https://github.com/1arley/animesice-back/commit/b576aedcc4d3384eb54f1bd03176d35604ca0f00))
* permitir usuarios deslogados assistirem videos (remover JwtAuthGuard de /embed/proxy e /embed/media) ([f3e4d07](https://github.com/1arley/animesice-back/commit/f3e4d07fe5b269b378b8bda0196aef5f391e140d))
* public stream source with re-extraction on cdn 403 ([31365e1](https://github.com/1arley/animesice-back/commit/31365e1a007fd1b5054e4635355f2599f21b34e6))
* **rating:** avaliações de animes ([1f3293a](https://github.com/1arley/animesice-back/commit/1f3293a986cfb724f6e44f71d7c8aef71dfc10ee))
* **recommendation:** recomendações por gêneros assistidos ([0dc7492](https://github.com/1arley/animesice-back/commit/0dc74923ca27cd47a38a8dde0456e57b6e6f69e3))
* role enum with indexes and admin-only user listing ([9c0cdde](https://github.com/1arley/animesice-back/commit/9c0cddeff9b676d5778abfc60573de337cbe7111))
* **room:** salas de watch party (websocket) ([0f3e612](https://github.com/1arley/animesice-back/commit/0f3e612e3ad506b07c3dcda0c89e03d29b1c3a74))
* **user-anime-list:** watchlist do usuário ([4ef12df](https://github.com/1arley/animesice-back/commit/4ef12df5c9c65b82048f18348c943c6839a1367a))
* **user:** perfil público e metadados (avatar/bio) ([4c5849f](https://github.com/1arley/animesice-back/commit/4c5849fcbec9d6222b737d82ee492c4034af53f1))
* **watch-history:** histórico e progresso de visualização ([b471d7e](https://github.com/1arley/animesice-back/commit/b471d7e5911ee1be8badecf352b852e64339869f))
