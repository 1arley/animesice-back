# AnimesIce Backend

Backend NestJS de um catálogo de animes: busca, detalhe, watch party, gacha de
cartas e streaming por proxy. Os termos abaixo descrevem o domínio do negócio, não
a implementação.

## Language

### Mídia e origem dos bytes

**Fonte de vídeo**:
A CDN externa (animefire/lightspeedst, googlevideo, r2.dev) de onde os bytes do
episódio realmente saem. Sempre externa ao AnimesIce.
_Avoid:_ host do vídeo, bucket.

**Egress**:
Banda que sai de um serviço para a internet. Aqui importa só o **egress do
Supabase**, e ele é **metadado** (leitura de banco), nunca byte de vídeo.
_Avoid:_ banda, tráfego.

**Byte de usuário**:
Qualquer mídia entregue diretamente ao browser de um visitante (vídeo, imagem).
Regra do domínio: o Supabase não serve byte de usuário.
_Avoid:_ asset, arquivo.

### Catálogo e visibilidade

**Vitrine**:
O catálogo visto por quem não pediu conteúdo adulto. Sempre filtra o Catálogo
Adulto.
_Avoid:_ home, grade, listagem.

**Catálogo Adulto**:
Títulos com age rating adulto (gênero `hentai`). Existe no banco, mas só aparece
sob opt-in explícito.
_Avoid:_ conteúdo NSFW, +18.

**Opt-in adulto**:
A escolha explícita de um visitante por ver o Catálogo Adulto (`includeHentai`).
Sem opt-in, a Vitrine nunca o inclui — inclusive no cache.
_Avoid:_ filtro, toggle.

### Formas de leitura do catálogo

**Card**:
A representação mínima de um anime num grid/lista (título, capa, nota, status). Não
carrega sinopse nem campos editoriais.
_Avoid:_ item, tile, célula.

**Detalhe**:
A página completa de um anime, onde sinopse, campos editoriais e a lista de
episódios são de fato exibidos. Único contexto que envia esses dados ao cliente.
_Avoid:_ página, view.
