# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-22)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([50b5d04](https://github.com/1arley/animesice-back/commit/50b5d04fda11434c4f4461d96142c7e31fcad58c))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([#67](https://github.com/1arley/animesice-back/issues/67)) ([6876169](https://github.com/1arley/animesice-back/commit/687616970190d099fc5a44f7395cf9dc6f02fa5b))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** make refresh rotation atomic ([661dc94](https://github.com/1arley/animesice-back/commit/661dc94a38dd2224fea42d8b1600ad937e9680d7))
* **auth:** reuse current refresh token on refresh ([605ab0a](https://github.com/1arley/animesice-back/commit/605ab0a75fa3378a6088895ab65654cd9f0c3420))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **economy:** drop unused ReviewSaleDto import (lint gate) ([7e38ece](https://github.com/1arley/animesice-back/commit/7e38ece4767944a2d74e035d23f46d0f36756fe5))
* **economy:** review fixes - pagination, seeded random, timing-safe webhook, ParseUUIDPipe, FOR UPDATE ([c6c1d63](https://github.com/1arley/animesice-back/commit/c6c1d63fc10d00066221964f663691bb848417b8))
* **embed:** add vidcache.net:8166 to allowed non-default ports ([1e46892](https://github.com/1arley/animesice-back/commit/1e46892f4c5b0b34c473e13cb60a41964ac8ebc5))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* **embed:** support subdomains in non-default port allowlist check ([56f6550](https://github.com/1arley/animesice-back/commit/56f6550496d2ec5030def1afaf13301ab264e3cd))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** raise trade card limit from 3 to 5 per side ([3272b38](https://github.com/1arley/animesice-back/commit/3272b3897e7b0acc8b6897e59f8e5b451e477c60))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* **gacha:** reroll cost = card value + 15% (was 10% of value) ([dc3721c](https://github.com/1arley/animesice-back/commit/dc3721c5923213bba96509b0f7aaad4ffed094ea))
* **gacha:** return dailyClaimedToday in GET /gacha/crystals response ([0810d6b](https://github.com/1arley/animesice-back/commit/0810d6bc39a52328b99234d2b1606808a87b2385))
* **gacha:** tolerate null svg in card-back sanitizer ([af83ef0](https://github.com/1arley/animesice-back/commit/af83ef08f3290e4271531a1af0fd5f4544d741e3))
* increase avatar max size from 50KB to 1MB ([7417938](https://github.com/1arley/animesice-back/commit/74179381a7a702a0bc4683e83c8f8b7688dd3efb))
* reject placeholder videos during extraction ([931e5e8](https://github.com/1arley/animesice-back/commit/931e5e8438031f71e2d82db69c03c84e202b9453))
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** fallback embedUrl iframe quando extração falha sem .mp4 ([de07082](https://github.com/1arley/animesice-back/commit/de070822ada6ccbef52b9f5eb6ce79fdc2f2f73b))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** remove fallback embedUrl iframe when extraction fails ([a3bd31a](https://github.com/1arley/animesice-back/commit/a3bd31ac87471830039c030b7878ea44c0d72773))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* **user:** serialize featuredRemainder BigInt in me endpoint ([66ef6e3](https://github.com/1arley/animesice-back/commit/66ef6e346c9de42e3e5b9c6418e74bce8c42c018))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add crystal codes system ([0ad8e7d](https://github.com/1arley/animesice-back/commit/0ad8e7d72532329eda371a454f66360e2de36c7e))
* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** refresh token rotation, shorter access token, brute-force fixes ([a032d12](https://github.com/1arley/animesice-back/commit/a032d1286143fc154cd00ddfe529fe607be47f3b))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add GET /gacha/card-backs/:key endpoint ([963b3a0](https://github.com/1arley/animesice-back/commit/963b3a0e3b050d839c9047ac9c301a7c786e920d))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** crystal economy config-driven + billing LivePix ([eb217f3](https://github.com/1arley/animesice-back/commit/eb217f3a277e1c2fa6f0663bf653f51218555a49))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** expand character pool to 50 per anime ([5620488](https://github.com/1arley/animesice-back/commit/56204884458fac2367943e5a4d5b6b0423c3d31f))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))
* **watchtower:** warmup sweep on startup and scope repair to published ([dd644fb](https://github.com/1arley/animesice-back/commit/dd644fb58aceecc504302c2ba30f4b89b10a387d))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))
* **streaming:** serve persisted source without blocking probe ([728f286](https://github.com/1arley/animesice-back/commit/728f2860910106b79b50a7ddb348216fb193b569))

# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-21)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([50b5d04](https://github.com/1arley/animesice-back/commit/50b5d04fda11434c4f4461d96142c7e31fcad58c))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([#67](https://github.com/1arley/animesice-back/issues/67)) ([6876169](https://github.com/1arley/animesice-back/commit/687616970190d099fc5a44f7395cf9dc6f02fa5b))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** make refresh rotation atomic ([661dc94](https://github.com/1arley/animesice-back/commit/661dc94a38dd2224fea42d8b1600ad937e9680d7))
* **auth:** reuse current refresh token on refresh ([605ab0a](https://github.com/1arley/animesice-back/commit/605ab0a75fa3378a6088895ab65654cd9f0c3420))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **economy:** drop unused ReviewSaleDto import (lint gate) ([7e38ece](https://github.com/1arley/animesice-back/commit/7e38ece4767944a2d74e035d23f46d0f36756fe5))
* **economy:** review fixes - pagination, seeded random, timing-safe webhook, ParseUUIDPipe, FOR UPDATE ([c6c1d63](https://github.com/1arley/animesice-back/commit/c6c1d63fc10d00066221964f663691bb848417b8))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** raise trade card limit from 3 to 5 per side ([3272b38](https://github.com/1arley/animesice-back/commit/3272b3897e7b0acc8b6897e59f8e5b451e477c60))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* **gacha:** reroll cost = card value + 15% (was 10% of value) ([dc3721c](https://github.com/1arley/animesice-back/commit/dc3721c5923213bba96509b0f7aaad4ffed094ea))
* **gacha:** return dailyClaimedToday in GET /gacha/crystals response ([0810d6b](https://github.com/1arley/animesice-back/commit/0810d6bc39a52328b99234d2b1606808a87b2385))
* increase avatar max size from 50KB to 1MB ([7417938](https://github.com/1arley/animesice-back/commit/74179381a7a702a0bc4683e83c8f8b7688dd3efb))
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* **user:** serialize featuredRemainder BigInt in me endpoint ([66ef6e3](https://github.com/1arley/animesice-back/commit/66ef6e346c9de42e3e5b9c6418e74bce8c42c018))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** refresh token rotation, shorter access token, brute-force fixes ([a032d12](https://github.com/1arley/animesice-back/commit/a032d1286143fc154cd00ddfe529fe607be47f3b))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add GET /gacha/card-backs/:key endpoint ([963b3a0](https://github.com/1arley/animesice-back/commit/963b3a0e3b050d839c9047ac9c301a7c786e920d))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** crystal economy config-driven + billing LivePix ([eb217f3](https://github.com/1arley/animesice-back/commit/eb217f3a277e1c2fa6f0663bf653f51218555a49))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** expand character pool to 50 per anime ([5620488](https://github.com/1arley/animesice-back/commit/56204884458fac2367943e5a4d5b6b0423c3d31f))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))
* **watchtower:** warmup sweep on startup and scope repair to published ([dd644fb](https://github.com/1arley/animesice-back/commit/dd644fb58aceecc504302c2ba30f4b89b10a387d))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))
* **streaming:** serve persisted source without blocking probe ([728f286](https://github.com/1arley/animesice-back/commit/728f2860910106b79b50a7ddb348216fb193b569))

# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-20)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([50b5d04](https://github.com/1arley/animesice-back/commit/50b5d04fda11434c4f4461d96142c7e31fcad58c))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([#67](https://github.com/1arley/animesice-back/issues/67)) ([6876169](https://github.com/1arley/animesice-back/commit/687616970190d099fc5a44f7395cf9dc6f02fa5b))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** make refresh rotation atomic ([661dc94](https://github.com/1arley/animesice-back/commit/661dc94a38dd2224fea42d8b1600ad937e9680d7))
* **auth:** reuse current refresh token on refresh ([605ab0a](https://github.com/1arley/animesice-back/commit/605ab0a75fa3378a6088895ab65654cd9f0c3420))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* **gacha:** reroll cost = card value + 15% (was 10% of value) ([dc3721c](https://github.com/1arley/animesice-back/commit/dc3721c5923213bba96509b0f7aaad4ffed094ea))
* **gacha:** return dailyClaimedToday in GET /gacha/crystals response ([0810d6b](https://github.com/1arley/animesice-back/commit/0810d6bc39a52328b99234d2b1606808a87b2385))
* increase avatar max size from 50KB to 1MB ([7417938](https://github.com/1arley/animesice-back/commit/74179381a7a702a0bc4683e83c8f8b7688dd3efb))
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* **user:** serialize featuredRemainder BigInt in me endpoint ([66ef6e3](https://github.com/1arley/animesice-back/commit/66ef6e346c9de42e3e5b9c6418e74bce8c42c018))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** refresh token rotation, shorter access token, brute-force fixes ([a032d12](https://github.com/1arley/animesice-back/commit/a032d1286143fc154cd00ddfe529fe607be47f3b))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add GET /gacha/card-backs/:key endpoint ([963b3a0](https://github.com/1arley/animesice-back/commit/963b3a0e3b050d839c9047ac9c301a7c786e920d))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** expand character pool to 50 per anime ([5620488](https://github.com/1arley/animesice-back/commit/56204884458fac2367943e5a4d5b6b0423c3d31f))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))
* **watchtower:** warmup sweep on startup and scope repair to published ([dd644fb](https://github.com/1arley/animesice-back/commit/dd644fb58aceecc504302c2ba30f4b89b10a387d))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))
* **streaming:** serve persisted source without blocking probe ([728f286](https://github.com/1arley/animesice-back/commit/728f2860910106b79b50a7ddb348216fb193b569))

# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-20)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([50b5d04](https://github.com/1arley/animesice-back/commit/50b5d04fda11434c4f4461d96142c7e31fcad58c))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([#67](https://github.com/1arley/animesice-back/issues/67)) ([6876169](https://github.com/1arley/animesice-back/commit/687616970190d099fc5a44f7395cf9dc6f02fa5b))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** reuse current refresh token on refresh ([605ab0a](https://github.com/1arley/animesice-back/commit/605ab0a75fa3378a6088895ab65654cd9f0c3420))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* **gacha:** reroll cost = card value + 15% (was 10% of value) ([dc3721c](https://github.com/1arley/animesice-back/commit/dc3721c5923213bba96509b0f7aaad4ffed094ea))
* increase avatar max size from 50KB to 1MB ([7417938](https://github.com/1arley/animesice-back/commit/74179381a7a702a0bc4683e83c8f8b7688dd3efb))
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* **user:** serialize featuredRemainder BigInt in me endpoint ([66ef6e3](https://github.com/1arley/animesice-back/commit/66ef6e346c9de42e3e5b9c6418e74bce8c42c018))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** expand character pool to 50 per anime ([5620488](https://github.com/1arley/animesice-back/commit/56204884458fac2367943e5a4d5b6b0423c3d31f))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))
* **watchtower:** warmup sweep on startup and scope repair to published ([dd644fb](https://github.com/1arley/animesice-back/commit/dd644fb58aceecc504302c2ba30f4b89b10a387d))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))
* **streaming:** serve persisted source without blocking probe ([728f286](https://github.com/1arley/animesice-back/commit/728f2860910106b79b50a7ddb348216fb193b569))

# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-20)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([50b5d04](https://github.com/1arley/animesice-back/commit/50b5d04fda11434c4f4461d96142c7e31fcad58c))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([#67](https://github.com/1arley/animesice-back/issues/67)) ([6876169](https://github.com/1arley/animesice-back/commit/687616970190d099fc5a44f7395cf9dc6f02fa5b))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** reuse current refresh token on refresh ([605ab0a](https://github.com/1arley/animesice-back/commit/605ab0a75fa3378a6088895ab65654cd9f0c3420))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* increase avatar max size from 50KB to 1MB ([7417938](https://github.com/1arley/animesice-back/commit/74179381a7a702a0bc4683e83c8f8b7688dd3efb))
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* **user:** serialize featuredRemainder BigInt in me endpoint ([66ef6e3](https://github.com/1arley/animesice-back/commit/66ef6e346c9de42e3e5b9c6418e74bce8c42c018))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** expand character pool to 50 per anime ([5620488](https://github.com/1arley/animesice-back/commit/56204884458fac2367943e5a4d5b6b0423c3d31f))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))
* **watchtower:** warmup sweep on startup and scope repair to published ([dd644fb](https://github.com/1arley/animesice-back/commit/dd644fb58aceecc504302c2ba30f4b89b10a387d))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))
* **streaming:** serve persisted source without blocking probe ([728f286](https://github.com/1arley/animesice-back/commit/728f2860910106b79b50a7ddb348216fb193b569))

# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-19)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([#67](https://github.com/1arley/animesice-back/issues/67)) ([6876169](https://github.com/1arley/animesice-back/commit/687616970190d099fc5a44f7395cf9dc6f02fa5b))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** reuse current refresh token on refresh ([605ab0a](https://github.com/1arley/animesice-back/commit/605ab0a75fa3378a6088895ab65654cd9f0c3420))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* **user:** serialize featuredRemainder BigInt in me endpoint ([66ef6e3](https://github.com/1arley/animesice-back/commit/66ef6e346c9de42e3e5b9c6418e74bce8c42c018))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))
* **watchtower:** warmup sweep on startup and scope repair to published ([dd644fb](https://github.com/1arley/animesice-back/commit/dd644fb58aceecc504302c2ba30f4b89b10a387d))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))
* **streaming:** serve persisted source without blocking probe ([728f286](https://github.com/1arley/animesice-back/commit/728f2860910106b79b50a7ddb348216fb193b569))

# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-19)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** adjust refresh token reuse tests for persistent token behavior ([#67](https://github.com/1arley/animesice-back/issues/67)) ([6876169](https://github.com/1arley/animesice-back/commit/687616970190d099fc5a44f7395cf9dc6f02fa5b))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** reuse current refresh token on refresh ([605ab0a](https://github.com/1arley/animesice-back/commit/605ab0a75fa3378a6088895ab65654cd9f0c3420))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* **user:** serialize featuredRemainder BigInt in me endpoint ([66ef6e3](https://github.com/1arley/animesice-back/commit/66ef6e346c9de42e3e5b9c6418e74bce8c42c018))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))
* **watchtower:** warmup sweep on startup and scope repair to published ([dd644fb](https://github.com/1arley/animesice-back/commit/dd644fb58aceecc504302c2ba30f4b89b10a387d))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))
* **streaming:** serve persisted source without blocking probe ([728f286](https://github.com/1arley/animesice-back/commit/728f2860910106b79b50a7ddb348216fb193b569))

# [1.29.0](https://github.com/1arley/animesice-back/compare/v1.28.0...v1.29.0) (2026-09-19)


### Bug Fixes

* **anime:** public catalog always filters published=true ([443ea47](https://github.com/1arley/animesice-back/commit/443ea47ee8a6436150c49cfaa09c200e67e69192))
* **api:** melhora tratamento de erros sem regressão ([4f6ae77](https://github.com/1arley/animesice-back/commit/4f6ae776634fffa64f43824be230c83ab8c0dae7))
* **auth:** align role cookie with refresh cookie options ([1b5b688](https://github.com/1arley/animesice-back/commit/1b5b688c0dc62af2b976199f4e8f0077168aa6a6))
* **auth:** transactionalize password reset + add Turnstile timeout ([f7ff24c](https://github.com/1arley/animesice-back/commit/f7ff24c4b4c84eb1c721711de97ccf0eb010a89d))
* **billing:** add AbortController timeouts to LivePix fetch calls ([f3246ba](https://github.com/1arley/animesice-back/commit/f3246ba6848bbd6ecb382270cc7b6cadef4a75b8))
* **billing:** use payments:write scope when creating LivePix bypass charges ([57f07e0](https://github.com/1arley/animesice-back/commit/57f07e0bcaeef108e0fa4ce4b2ac7dfc02dcdd2b))
* **ci:** restore backend test compatibility ([c58a289](https://github.com/1arley/animesice-back/commit/c58a2893d564b73e46e94b7e2cd14e8e209f26c0))
* **deps:** força multer ^2.3.0 via overrides contra GHSA DoS ([df6f002](https://github.com/1arley/animesice-back/commit/df6f0021cb26514584eb88063fd2bb6ce6da1dea))
* **deps:** override multer vulnerability ([3786f20](https://github.com/1arley/animesice-back/commit/3786f202f9cb440aea41a8d8016e7e86daa79d8e))
* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([6b3ca0f](https://github.com/1arley/animesice-back/commit/6b3ca0f06b844480ce4ea957808710523deecd55))
* fire-and-forget unhandled notifications + filter visible comments ([9b03a45](https://github.com/1arley/animesice-back/commit/9b03a456789f3300bccb6780fc4810db7c8d4bb2))
* **gacha:** disable daily card roll ([dc693af](https://github.com/1arley/animesice-back/commit/dc693afa85b23d0080a7ef7bfad68465ee07b14c))
* **gacha:** expõe coleção pública sem quebrar a privacidade ([4e4947f](https://github.com/1arley/animesice-back/commit/4e4947f1fa3be1b40cc1c4ef477f7f5e888fcc1a))
* **gacha:** make claims atomic and use LivePix payments ([59369ee](https://github.com/1arley/animesice-back/commit/59369ee505a23f6d714608fff40affe2f014e1be))
* **gacha:** malCharacterId sintetico em carta manual do admin ([3d87ba2](https://github.com/1arley/animesice-back/commit/3d87ba2128d6266235b7c043899524c364604f87))
* **gacha:** recalibra curva de valor das raridades e bônus de edição proporcional ([3d1b70c](https://github.com/1arley/animesice-back/commit/3d1b70c58a88ee09f5fbb2dd07c5a0a35b9b945a)), closes [#1](https://github.com/1arley/animesice-back/issues/1) [#10](https://github.com/1arley/animesice-back/issues/10)
* **scrape:** pula retry Xvfb quando token Blogger nem carrega ([015daae](https://github.com/1arley/animesice-back/commit/015daaec57ff357d18f5365fa6e1e128e08acde6))
* **security:** corrige vulnerabilidades de auditoria no backend ([db75584](https://github.com/1arley/animesice-back/commit/db75584c876e8004698c6f8f0093595ebc70fe37))
* serialize gacha remainder and probe async sources ([e920a95](https://github.com/1arley/animesice-back/commit/e920a953fc5b7af6e1d221a5ac7a88756978db27))
* **social:** gate post detail by profilePublic + fix interleaved pagination ([d245d6a](https://github.com/1arley/animesice-back/commit/d245d6ad889d35343fb62d9e02665035de23b386))
* **stream:** accept embed sources from async jobs ([2a0861b](https://github.com/1arley/animesice-back/commit/2a0861bbb8056f93f18bc6f221988f56fad78be6))
* **streaming:** persiste extraction jobs no Postgres com dedup e lease ([ee1ee7a](https://github.com/1arley/animesice-back/commit/ee1ee7a9ed2b92628fdda9c3ff9a13126da0dbb9))
* **streaming:** restore backendOrigin host allowlist and prod guard ([b2fad7d](https://github.com/1arley/animesice-back/commit/b2fad7d8c8c3ed7ca149062f180910f32c95a0f8))
* **streaming:** skip liveness on resolve and fall back to last known videoUrl ([de1019b](https://github.com/1arley/animesice-back/commit/de1019b69f37bedad9fd2647d5ad4f35455a1df3))
* **streaming:** source/async devolve source direto quando vídeo está pronto ([9f595fd](https://github.com/1arley/animesice-back/commit/9f595fddbee021368618e4ec1bd9b923fa9517d8))
* **streaming:** treat upstream 5xx as dead and validate fresh URLs before saving ([be861e0](https://github.com/1arley/animesice-back/commit/be861e0de5e40ce292f568789dd94d08082cdbe5))
* **tests:** align specs with current service behavior ([09bc175](https://github.com/1arley/animesice-back/commit/09bc1751f11e41f68b2b222118b7f0b3bde875d3))
* transações atômicas em trade/settle/upvote, keyset cursor no sync, reconciliação de pagamento e timeout no fetchSafeRaw ([6c0ff31](https://github.com/1arley/animesice-back/commit/6c0ff314d69f747560c4fc61dec34e0bc403bd9b))
* use contentType column in AvatarFile queries ([d2c74a3](https://github.com/1arley/animesice-back/commit/d2c74a3bb3619f170072527d92878cc9301da08e))
* validate numeric filters + align avatar column names ([c042804](https://github.com/1arley/animesice-back/commit/c042804d51872352f2f39dacb67cc2f228e2ee7a))
* **watchtower:** adult sync em background sem bloquear app.listen() ([593b553](https://github.com/1arley/animesice-back/commit/593b55367f1229d6de1be0ca372d53008f40bcbf))
* **watchtower:** cast int no enqueueMany para destravar GAP_CHECK ([236ee68](https://github.com/1arley/animesice-back/commit/236ee68ddd6116ba8ac44274f546945a74072ac1))
* **watchtower:** deduplica dedupeKey no GAP_CHECK para evitar 21000 do ON CONFLICT ([73a8955](https://github.com/1arley/animesice-back/commit/73a8955aa4e1bde7e42481a38b3904fd684e12c2))
* **watchtower:** select shared adult source fields ([ec5a267](https://github.com/1arley/animesice-back/commit/ec5a2670d2f1e79d2880df997e2d638bebbca2f2))
* **watchtower:** sync adult catalog on startup ([76dc1fc](https://github.com/1arley/animesice-back/commit/76dc1fcf2cc9bb544bbf65c018b779e40e4722a6))


### Features

* add gacha skins and database avatars ([232954c](https://github.com/1arley/animesice-back/commit/232954cb8b79b176f60879bf4a780076928bdb0a))
* **admin:** audit decorators, season param on episodes, mutation log endpoint ([b462cb1](https://github.com/1arley/animesice-back/commit/b462cb1a36e96d419d39a118da0ebbf241c0d9e8))
* **admin:** criar obra externa via MAL/AniList e bonus diario 200 ([80bdc76](https://github.com/1arley/animesice-back/commit/80bdc763f2b40f155d77d923b5ea03a5ecba87ba))
* **app:** register global MaintenanceInterceptor ([afe9c21](https://github.com/1arley/animesice-back/commit/afe9c2189f4722d4d3d53534aba1a1d88558a118))
* **auth:** reject banned users at login, refresh, and registration ([ce8f8d8](https://github.com/1arley/animesice-back/commit/ce8f8d8c489de6cb616df39b5739957d7b03d3ae))
* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([853b3c3](https://github.com/1arley/animesice-back/commit/853b3c3090fafc92e4d884b62a3fd80824e1f73e))
* **gacha:** 5 giros/hora com preview, claim 1/12h e bypass LivePix ([f737470](https://github.com/1arley/animesice-back/commit/f737470031874bc36e060b2513f84e7e2acbc92c))
* **gacha:** 7 tiers de raridade, pity em EPICA+ e filtros nos endpoints admin ([46c60e9](https://github.com/1arley/animesice-back/commit/46c60e9f6ac70c1c84cd6e2eca4cab252df122af))
* **gacha:** add admin card controls and value overrides ([9ecf724](https://github.com/1arley/animesice-back/commit/9ecf72471fe84309b315395457401c27d8c2f776))
* **gacha:** add burn system, UserCard status filtering, and repricing ([e7b1943](https://github.com/1arley/animesice-back/commit/e7b19436285f1c21e52797cc716a54265217825c))
* **gacha:** add card publication workflow and active pool filtering ([35ca29e](https://github.com/1arley/animesice-back/commit/35ca29e442ca2286999b9f391b199f0655304b44))
* **gacha:** add card wishlist with toggle endpoints and profile listing ([07311ff](https://github.com/1arley/animesice-back/commit/07311ff870084a5d5bd71de24328996200d82da9))
* **gacha:** add card-back shop, dynamic rarities, collections and encyclopedia filters ([fe13a9e](https://github.com/1arley/animesice-back/commit/fe13a9e8215f6c0bfd25acb0b90f11262125e652))
* **gacha:** add featured rewards database schema and migration ([281b234](https://github.com/1arley/animesice-back/commit/281b234af80ffff1d1764531078c6a348217d56e))
* **gacha:** add rarities, collections, card backs and original owner tables ([8d026d5](https://github.com/1arley/animesice-back/commit/8d026d575f451056ce82080190cfde8b04c025c2))
* **gacha:** add skin catalog, spins and equipment ([9de018f](https://github.com/1arley/animesice-back/commit/9de018f8c20ef21ebcd6c6b912a42c64cf1e2010))
* **gacha:** adiciona coleção e carta destacada ([51dbafa](https://github.com/1arley/animesice-back/commit/51dbafa3ca64aaacadd8cb3561493095e57c0701))
* **gacha:** adiciona gacha waifu com roll diario, pity e feed ([083e766](https://github.com/1arley/animesice-back/commit/083e76633fd773d33346a747757e5b802db15b92))
* **gacha:** backfill alternate skin images ([8a2353e](https://github.com/1arley/animesice-back/commit/8a2353e353fa2f803e31422bfa0b0aa5919bbb85))
* **gacha:** backfill skin images from official MAL API ([4e37553](https://github.com/1arley/animesice-back/commit/4e3755363187762972f18490a7f877f8882764b0))
* **gacha:** claim lock per rarity + crystal economy ([080640b](https://github.com/1arley/animesice-back/commit/080640b2f1f6e0f0d81d1365c3e36547cf2a149a))
* **gacha:** enciclopédia da coleção e flag de conjunto completo no perfil ([84f7d01](https://github.com/1arley/animesice-back/commit/84f7d013b38fca152c097ca429828ad06f696a20))
* **gacha:** endpoints admin para pool de cartas, concessão, remoção e reset de roll ([c450ec6](https://github.com/1arley/animesice-back/commit/c450ec6319b9bebba63f16a54b1f315a6d963dd1))
* **gacha:** ensure skin art differs from base card ([6a523bb](https://github.com/1arley/animesice-back/commit/6a523bb6d20e6562dbd7389728828a4f603ed09a))
* **gacha:** fase 1 — carteira de pontos com mint no claim, extrato e ajuste admin ([bf87e3a](https://github.com/1arley/animesice-back/commit/bf87e3aecd6858207b44fa5cfe77abb7291f8fc0))
* **gacha:** fase 2 — reroll por pontos e loja de cosméticos ([412c9c1](https://github.com/1arley/animesice-back/commit/412c9c1cd66820cbc675291b6133ea03c6c2ec2c))
* **gacha:** fase 3 — mercado de cartas por pontos (anúncio, buy-now, taxa 10% queimada) ([3e7f545](https://github.com/1arley/animesice-back/commit/3e7f545463b4dbef123fcb406dd70af98216722e))
* **gacha:** implement gacha API layer ([391a02a](https://github.com/1arley/animesice-back/commit/391a02af786400277462e67c7b908600b8fa1270))
* **gacha:** lock de claim de 12h para 6h ([26778fa](https://github.com/1arley/animesice-back/commit/26778fa53612229ca16b1adbc180b347979c353b))
* **gacha:** reequilibra valor base de MITICA e GALACTICA ([99a2470](https://github.com/1arley/animesice-back/commit/99a247024df32273e9841ea36f31143da4fcab47))
* **gacha:** resgate único de compensação com giro garantido por notificação ([7e5b3e1](https://github.com/1arley/animesice-back/commit/7e5b3e121af434bd8da9e8e5d246b09933b53030))
* **gacha:** seed via API oficial do MAL (num_favorites real, sem Jikan) ([f015682](https://github.com/1arley/animesice-back/commit/f015682a955e52955c7b1b47f19515684cd8c953))
* **gacha:** support trades with up to three cards per side ([e53df86](https://github.com/1arley/animesice-back/commit/e53df868a042e6957b904ca8b54efcdbff77d5a9))
* **gacha:** troca de cartas 1:1 — escrow com confirmação ([ed08416](https://github.com/1arley/animesice-back/commit/ed0841627d0a17f483f230338844d55392b845f9))
* **moderation:** enforce restrictions on content creation, improve audit ([30a9a96](https://github.com/1arley/animesice-back/commit/30a9a9698e86941c43db98bd9da0e6a5176c5831))
* **scraping:** adiciona tioanime como fallback e suporte a proxy para animefire ([547f7e2](https://github.com/1arley/animesice-back/commit/547f7e226a9f4704d3868a2f591ec135ce270a21))
* **scraping:** persist MeusAnimes source urls, gate TioAnime, add AnimesDigital adapter ([5b19ee7](https://github.com/1arley/animesice-back/commit/5b19ee72fa89b5d63643cda7fbac7b2ccd8300c0))
* **settings:** public settings endpoint, role guard, vote counter fix ([45615c6](https://github.com/1arley/animesice-back/commit/45615c6d40c5d62da8365eb540d942c6ce558165))
* **social,rating,room:** harden concurrency, idempotency and captcha ([8b0001c](https://github.com/1arley/animesice-back/commit/8b0001c6903b65794cf758a48407e4f237155038))
* **social:** resolve live card data for gacha_pull posts in feed ([a1336e7](https://github.com/1arley/animesice-back/commit/a1336e79652b8edf0211b1dc4919187346f39cbb))
* **streaming:** extract backendOrigin util, filter novideo placeholders ([3be72ed](https://github.com/1arley/animesice-back/commit/3be72edf7781e1d838ce4a0bf1cec5a795de3b71))
* **watchtower:** add tioanime source and admin disable flag ([35141c5](https://github.com/1arley/animesice-back/commit/35141c5bb401e4c0d63ad1eb402d601060498fdd))


### Performance Improvements

* **anime:** corta egress Supabase com projeção, cache TTL e sync incremental ([04bd555](https://github.com/1arley/animesice-back/commit/04bd5552e6399b4a91ea2ed38c9a8588f8be552c))

# [1.28.0](https://github.com/1arley/animesice-back/compare/v1.27.2...v1.28.0) (2026-09-09)


### Bug Fixes

* **watchtower:** sync adult catalog on startup ([089315f](https://github.com/1arley/animesice-back/commit/089315f514b1af3387ad062a87775e9c602e84f6))


### Features

* **catalog:** oculta catalogo adulto da vitrine com opt-in na busca ([c9a9bf6](https://github.com/1arley/animesice-back/commit/c9a9bf6f1d2f88de26f7c940ac999d4668f758ab))

## [1.27.2](https://github.com/1arley/animesice-back/compare/v1.27.1...v1.27.2) (2026-09-08)


### Bug Fixes

* **embed:** allow vidcache.net:8161 media port in proxy allowlist ([f27e233](https://github.com/1arley/animesice-back/commit/f27e23364d150cea6d3263f923cf500e5b6484b1))

## [1.27.1](https://github.com/1arley/animesice-back/compare/v1.27.0...v1.27.1) (2026-09-08)


### Bug Fixes

* **scrape:** pass outbound proxy to Chromium via playwrightProxy() ([e9731d8](https://github.com/1arley/animesice-back/commit/e9731d8bd1ed0a45206c575ac26c08f0d31224be))

# [1.27.0](https://github.com/1arley/animesice-back/compare/v1.26.0...v1.27.0) (2026-09-08)


### Bug Fixes

* **ci:** restore dev CI — episode specs, coverage gate, npm audit ([5af8e9c](https://github.com/1arley/animesice-back/commit/5af8e9ced8591258eb1ce94216c25ac37ca69e10))
* **scrape:** resolve regressão na extração de player tokens Blogger ([8f66f00](https://github.com/1arley/animesice-back/commit/8f66f008529d9e00d8ee6958df9ae810a0530577)), closes [#42](https://github.com/1arley/animesice-back/issues/42)


### Features

* **streaming:** extração assíncrona, browser pool, waits event-based, prefetch ([1bfaf11](https://github.com/1arley/animesice-back/commit/1bfaf1107baba4d3ddae4db54d227d65f8b89925))
* **streaming:** sse, poll com src, completion callback, max-jobs configuravel ([796da5c](https://github.com/1arley/animesice-back/commit/796da5c053ae07fcd842aa19f752346f48176bfa))


### Performance Improvements

* **episode:** merge queries, inject episode numbers, simplify incrementViews ([176a84e](https://github.com/1arley/animesice-back/commit/176a84ea65767507f1298ee4a18293b7fa7cd185))
* **probe:** expand liveness cache TTL from 5min to 30min ([97db903](https://github.com/1arley/animesice-back/commit/97db903fe770a2a2e8a023ee8a9bfa6d54d63dcd))

# [1.26.0](https://github.com/1arley/animesice-back/compare/v1.25.1...v1.26.0) (2026-09-08)


### Features

* **streaming:** add async source extraction endpoint with job polling ([b7c6009](https://github.com/1arley/animesice-back/commit/b7c60091b65b3fcdd60d42fe6b74c37c082223f6))

## [1.25.1](https://github.com/1arley/animesice-back/compare/v1.25.0...v1.25.1) (2026-09-08)


### Bug Fixes

* **docker:** move prisma CLI to dependencies — prod image ships pinned CLI preventing npx from fetching broken v8 RC ([4d7bf36](https://github.com/1arley/animesice-back/commit/4d7bf366cfdd1f01526fef217f8caebd13514226))

# [1.25.0](https://github.com/1arley/animesice-back/compare/v1.24.4...v1.25.0) (2026-08-26)


### Bug Fixes

* **e2e:** usa prisma migrate reset no setup local ([50b2e08](https://github.com/1arley/animesice-back/commit/50b2e081c159d9f6125b1fccafa754a6bbb4659e))
* **embed:** load outbound allowlist from runtime config ([830c6f4](https://github.com/1arley/animesice-back/commit/830c6f49c17cb70ee998eb799e677bfe54c35292))
* resolve regressões do PR [#42](https://github.com/1arley/animesice-back/issues/42) — streaming fallback, schedule-sync pagination, CI ([74ac442](https://github.com/1arley/animesice-back/commit/74ac44242dab12152f30139e73962c8e37b58d62))
* **streaming:** preserve provider player fallback ([869424c](https://github.com/1arley/animesice-back/commit/869424c2fc828cb28fc0e3502c37a5a8b028f64e))
* **watchtower:** cast anilist_id para int no raw SQL do backfill ([a31fbde](https://github.com/1arley/animesice-back/commit/a31fbdefab52ba445da1ba807babe4d68b951d66))
* **watchtower:** cast end_date para timestamptz no raw SQL ([4eb29f9](https://github.com/1arley/animesice-back/commit/4eb29f99bee164ea217051c280ab37e98bebaee0))
* **watchtower:** cast year, episodeCount e dayOfWeek para int no raw SQL ([013d5df](https://github.com/1arley/animesice-back/commit/013d5df34b6a502335efe95abf0ad699a3d8bae4))
* **watchtower:** previne PrismaClientKnownRequestError no backfill e sync de calendário ([95db5d4](https://github.com/1arley/animesice-back/commit/95db5d428ce8f2c269175b36ce7b6a12b66ea53a))
* **watchtower:** sync limitado a animes em lançamento + enfileira no startup ([fe0de2d](https://github.com/1arley/animesice-back/commit/fe0de2d7267004dc369b66326b335de8a41fd239))


### Features

* **watchtower:** enfileira backfill+sync no startup do container ([702389e](https://github.com/1arley/animesice-back/commit/702389e0eff453a6007b6883b2372da04772172c))

## [1.24.4](https://github.com/1arley/animesice-back/compare/v1.24.3...v1.24.4) (2026-08-24)


### Bug Fixes

* **streaming:** preserve provider player fallback ([#38](https://github.com/1arley/animesice-back/issues/38)) ([9c73099](https://github.com/1arley/animesice-back/commit/9c73099e0d3cea4b0c5af962bffb545cd340d9c1))

## [1.24.3](https://github.com/1arley/animesice-back/compare/v1.24.2...v1.24.3) (2026-08-24)


### Bug Fixes

* **streaming:** refresh dead sources before response ([a9888a6](https://github.com/1arley/animesice-back/commit/a9888a6bb37b5d5cf8ec6cad726065b2c7e0c175))

## [1.24.2](https://github.com/1arley/animesice-back/compare/v1.24.1...v1.24.2) (2026-08-23)


### Bug Fixes

* streaming cache eviction, SSRF URL normalization, watchtower batch enqueue ([#32](https://github.com/1arley/animesice-back/issues/32) [#33](https://github.com/1arley/animesice-back/issues/33) [#34](https://github.com/1arley/animesice-back/issues/34)) ([#37](https://github.com/1arley/animesice-back/issues/37)) ([f6d716f](https://github.com/1arley/animesice-back/commit/f6d716f5c2870e7dc08f2b2ff4fb3d31d90901a7))

## [1.24.1](https://github.com/1arley/animesice-back/compare/v1.24.0...v1.24.1) (2026-08-23)


### Bug Fixes

* **ci:** update repair-worker tests for enqueueMany and add coverage/ to eslintignore ([69ee653](https://github.com/1arley/animesice-back/commit/69ee65341f88653f9f697d4f617de4021198d428))
* correct mock types in meusanimes.source.spec.ts ([53a025b](https://github.com/1arley/animesice-back/commit/53a025b84f48af931bec1f4f815c4e87bdf01b2f))
* remove invalid allowVidetagProtocolInlining option from sanitize-html ([5bf7940](https://github.com/1arley/animesice-back/commit/5bf7940b5c56d6dea9b78663201f4e55085a4607))
* **security:** corrige 5 vulnerabilidades criticas ([0f9f903](https://github.com/1arley/animesice-back/commit/0f9f903cfc438bde023554648718bc9f2b879125))
* **streaming:** add max-size eviction to scrapeCache and livenessCache ([#32](https://github.com/1arley/animesice-back/issues/32)) ([132f106](https://github.com/1arley/animesice-back/commit/132f106629ef5fb3ec4e759d6c4ef63c36b26549))
* **tests:** adjust unit tests for updated sanitizer and SSRF module mocking ([a36a865](https://github.com/1arley/animesice-back/commit/a36a865d2735e42b40bbe38f3fb27b35f2cefcf1))
* type dispatcher mock as undici Dispatcher in spec ([fee952d](https://github.com/1arley/animesice-back/commit/fee952d281df0a748c6908ea59490e58b6316287))
* **watchtower:** batch enqueue calls to eliminate N+1 queries ([#34](https://github.com/1arley/animesice-back/issues/34)) ([60abdbc](https://github.com/1arley/animesice-back/commit/60abdbc795a45cc1113371bd2c7e3d564fc7d41e))

# [1.24.0](https://github.com/1arley/animesice-back/compare/v1.23.1...v1.24.0) (2026-08-22)


### Features

* add editorial fields to anime and update admin DTO ([d7a9ba6](https://github.com/1arley/animesice-back/commit/d7a9ba6543df39ae058b730e9d0c91c19dc3859a))

## [1.23.1](https://github.com/1arley/animesice-back/compare/v1.23.0...v1.23.1) (2026-08-22)


### Bug Fixes

* **watch-party:** garante sincronizacao autoritativa ([0112c01](https://github.com/1arley/animesice-back/commit/0112c0119bef347a405bcaa635c4ded16c62a802))

# [1.23.0](https://github.com/1arley/animesice-back/compare/v1.22.0...v1.23.0) (2026-08-22)


### Features

* **blog:** adiciona CMS editorial ([adbb92b](https://github.com/1arley/animesice-back/commit/adbb92bb30631262322c67553d54090c98172321))

# [1.22.0](https://github.com/1arley/animesice-back/compare/v1.21.0...v1.22.0) (2026-08-20)


### Bug Fixes

* **search:** prioriza match exato e pagina por relevância fuzzy ([b650cfa](https://github.com/1arley/animesice-back/commit/b650cfa7677fde45010bac1147751390c9f4c9ba))


### Features

* **back:** update admin DTOs for anime import and update ([d7f2053](https://github.com/1arley/animesice-back/commit/d7f2053a2c6bb80550871b2ba66a72185e00cb17))
* **common:** probe de mídia aceita modo forçado de rede ([323325c](https://github.com/1arley/animesice-back/commit/323325c264a771e7066d6331cbf7b43a2478d449))
* **embed:** scrape aceita refresh forçado que ignora cache ([0bb3d46](https://github.com/1arley/animesice-back/commit/0bb3d4685b33cd6ca5efb9d917f965c96997cf22))
* **streaming:** endpoint aceita ?refresh=1 para re-extração do source ([bcd7f4a](https://github.com/1arley/animesice-back/commit/bcd7f4a7a19c48e49c7f03388df203f5550e593a))

# [1.21.0](https://github.com/1arley/animesice-back/compare/v1.20.3...v1.21.0) (2026-08-20)


### Features

* **common:** deriva o áudio do título (dublado → DUBLADO) em vez de valor manual ([e9d1126](https://github.com/1arley/animesice-back/commit/e9d1126bf88fa6798174476508e9f48eb485aafb))

## [1.20.3](https://github.com/1arley/animesice-back/compare/v1.20.2...v1.20.3) (2026-08-18)


### Bug Fixes

* **api:** published filter em busca, throttler atrás de proxy, rename Jikan para MAL no seed, script enrich-synopsis ([e9d8d73](https://github.com/1arley/animesice-back/commit/e9d8d73473f143ecc634bd61e1c9f9355adba303))

## [1.20.2](https://github.com/1arley/animesice-back/compare/v1.20.1...v1.20.2) (2026-08-18)


### Bug Fixes

* **streaming:** restore media proxy and queue extraction bursts ([e551499](https://github.com/1arley/animesice-back/commit/e551499090c5994985f357ac6fcc13571af068c2))

## [1.20.1](https://github.com/1arley/animesice-back/compare/v1.20.0...v1.20.1) (2026-08-18)


### Bug Fixes

* **embed:** converte ReadableStream web em Readable e libera agent DNS pinado ([5d07e0a](https://github.com/1arley/animesice-back/commit/5d07e0a20b08349b7f89f5cd07041126b37353f4))

# [1.20.0](https://github.com/1arley/animesice-back/compare/v1.19.0...v1.20.0) (2026-08-17)


### Bug Fixes

* **ssrf:** pin DNS resolution to close TOCTOU rebinding window ([070e0d7](https://github.com/1arley/animesice-back/commit/070e0d7f4971dfec6965ace585fb8ff2838e0cbb))
* type cast ssrf.spec.ts and CodeQL suppression embed.service.ts ([74e008d](https://github.com/1arley/animesice-back/commit/74e008d94396d09dd3ecff659f06525211739cad))


### Features

* batch query optimizations and performance indexes for Issue [#34](https://github.com/1arley/animesice-back/issues/34) ([211d042](https://github.com/1arley/animesice-back/commit/211d04285c7fcd5fdfe6886392269f7e7ab1454b))


### Performance Improvements

* **streaming:** cache de liveness com TTL e limpeza periódica de caches ([1a077a1](https://github.com/1arley/animesice-back/commit/1a077a1b94cc190d3e71acc73d0d72f0ce753aa9))

# [1.19.0](https://github.com/1arley/animesice-back/compare/v1.18.0...v1.19.0) (2026-08-17)


### Features

* add watch-history deletion endpoint ([e9fed89](https://github.com/1arley/animesice-back/commit/e9fed89f3adf77dcddde68c2b2435a01eee3c59d))

# [1.18.0](https://github.com/1arley/animesice-back/compare/v1.17.0...v1.18.0) (2026-08-16)


### Features

* **scripts:** backfill enriquecer catalogo com dados do AniList ([8fc5e97](https://github.com/1arley/animesice-back/commit/8fc5e9765ae8643b55158a870e2c418174b00e04))

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
