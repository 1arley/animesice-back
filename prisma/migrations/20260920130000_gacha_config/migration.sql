-- CreateTable
CREATE TABLE "GachaConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GachaConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "GachaConfig_group_idx" ON "GachaConfig"("group");

-- Seed: economy basics
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('rolls_per_day',    '1',        'Rolls gratuitos por dia',       'economia', NOW()),
('pity_days',        '30',       'Dias até pity garantir épica+', 'economia', NOW()),
('pool_per_anime',   '8',        'Cartas disponíveis por anime',  'economia', NOW()),
('spins_per_hour',   '5',        'Spins de skin por hora',        'economia', NOW()),
('reroll_cost_pct',  '0.15',     'Custo do reroll (fração do valor)', 'economia', NOW()),
('daily_bonus',      '350',      'Bônus diário em Crystals',      'economia', NOW()),
('economy_rollout_percent', '0', 'Percentual do rollout da economia', 'economia', NOW()),
('key_price', '1500', 'Preço da chave universal', 'economia', NOW()),
('box_prices', '{"COMMON":2500,"RARE":5500,"PREMIUM":8500}', 'Preço das caixas', 'economia', NOW()),
('collection_rewards', '{"25":1000,"50":2500,"100":6000}', 'Recompensas de coleção', 'economia', NOW());

-- Seed: bypass (real money)
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('bypass_price_cents', '299',    'Preço do bypass em centavos',   'bypass', NOW()),
('bypass_ttl_ms',      '1800000','TTL do bypass em ms (30 min)',   'bypass', NOW());

-- Seed: market
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('listing_active_limit', '20',   'Máximo de anúncios ativos',     'mercado', NOW()),
('listing_ttl_ms', '604800000',  'Duração do anúncio (7 dias)',   'mercado', NOW()),
('buy_order_active_limit', '5',  'Máximo de ordens de compra',    'mercado', NOW()),
('market_tax_pct',       '0.1',  'Taxa do mercado (fração)',      'mercado', NOW()),
('official_price_markup', '1.35','Multiplicador da mediana oficial', 'mercado', NOW()),
('night_market_start_day', '1',  'Dia inicial do Mercado Noturno', 'mercado', NOW()),
('night_market_duration_days', '7', 'Duração do Mercado Noturno', 'mercado', NOW());

-- Seed: trade
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('trade_ttl_ms',        '172800000', 'TTL de troca em ms (48h)',    'trocas', NOW()),
('trade_active_limit',  '3',         'Máximo de trocas ativas',     'trocas', NOW());

-- Seed: skin spin
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('skin_spin_cooldown_ms', '604800000', 'Cooldown do giro grátis de skin (7 dias)', 'skins', NOW()),
('skin_spin_price',       '0',         'Giro de skin não possui compra direta',    'skins', NOW()),
('skin_floors', '{"COMMON":2000,"RARE":4000,"EPIC":7000,"LEGENDARY":12000}', 'Pisos oficiais de skins', 'skins', NOW());

-- Seed: featured card
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('featured_accrual_limit_ms',      '604800000', 'Limite de acúmulo em ms (7 dias)',       'destaque', NOW()),
('featured_productive_ms_per_day', '36000000',  'Horas produtivas por dia em ms (10h)',   'destaque', NOW());

-- Seed: drop rates
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('tier_weights', '{"COMUM":55,"INCOMUM":25,"RARA":12,"EPICA":5.5,"LENDARIA":2,"MITICA":0.4,"GALACTICA":0.1}',
  'Peso de drop por tier', 'rates', NOW()),
('pity_weights', '{"COMUM":0,"INCOMUM":0,"RARA":0,"EPICA":70,"LENDARIA":20,"MITICA":8,"GALACTICA":2}',
  'Peso de drop no pity', 'rates', NOW()),
('foil_weights', '{"NORMAL":85,"HOLO":12,"GOLD":3}',
  'Peso de foil', 'rates', NOW()),
('box_category_weights', '{"COMMON":{"CRYSTAL":50,"SPIN_RESET":30,"CARD":8,"SKIN":5,"KEY":5,"CARD_BACK":2},"RARE":{"CRYSTAL":40,"SPIN_RESET":25,"CARD":14,"SKIN":9,"KEY":7,"CARD_BACK":5},"PREMIUM":{"CRYSTAL":30,"SPIN_RESET":20,"CARD":22,"SKIN":14,"KEY":8,"CARD_BACK":6}}', 'Pesos de categoria das caixas', 'rates', NOW()),
('box_quality_weights', '{"COMMON":{"BASIC":65,"RARE":25,"EPIC":8,"LEGENDARY":2},"RARE":{"BASIC":40,"RARE":35,"EPIC":20,"LEGENDARY":5},"PREMIUM":{"BASIC":20,"RARE":35,"EPIC":30,"LEGENDARY":15}}', 'Pesos de qualidade das caixas', 'rates', NOW());

-- Seed: values
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('base_value', '{"COMUM":10,"INCOMUM":25,"RARA":60,"EPICA":150,"LENDARIA":400,"MITICA":800,"GALACTICA":1600}',
  'Valor base por tier', 'valores', NOW()),
('foil_mult', '{"NORMAL":1,"HOLO":3,"GOLD":10}',
  'Multiplicador de foil', 'valores', NOW()),
('card_floors', '{"COMUM":500,"INCOMUM":750,"RARA":1250,"EPICA":2500,"LENDARIA":5000,"MITICA":9000,"GALACTICA":15000}', 'Pisos oficiais de cartas', 'valores', NOW()),
('burn_payout', '{"COMUM":100,"INCOMUM":150,"RARA":250,"EPICA":500,"LENDARIA":1000,"MITICA":1800,"GALACTICA":3000}', 'Pagamento do burn por tier', 'valores', NOW()),
('crystal_packages', '{"BRL_490":{"cents":490,"crystals":950},"BRL_990":{"cents":990,"crystals":2000},"BRL_1990":{"cents":1990,"crystals":4200},"BRL_2990":{"cents":2990,"crystals":6500},"BRL_4990":{"cents":4990,"crystals":11250}}', 'Pacotes oficiais de Crystal', 'valores', NOW());

-- Seed: claim lock
INSERT INTO "GachaConfig" ("key", "value", "label", "group", "updatedAt") VALUES
('claim_lock_hours', '{"COMUM":1,"INCOMUM":2,"RARA":3,"EPICA":4,"LENDARIA":5,"MITICA":6,"GALACTICA":7}',
  'Horas de lock por tier', 'valores', NOW());
