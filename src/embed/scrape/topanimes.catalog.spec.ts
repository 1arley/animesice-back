import { parseTopanimesCatalog } from './topanimes.catalog';

/** Trecho real da página /animes/<slug>/ do topanimes (tema Dooplay). */
const HTML = `
  <div class="sheader">
    <div class="blur">
      <div class="poster">
        <img itemprop="image" src="https://image.tmdb.org/t/p/w500/poster.jpg" alt="Avatar: Seven Havens">
      </div>
      <div class="data">
        <h1>Avatar: Seven Havens</h1>
        <div class="sgeneros">
          <a href="https://topanimes.net/genero/acao/" rel="tag">Ação</a>
          <a href="https://topanimes.net/genero/fantasia/" rel="tag">Fantasia</a>
        </div>
      </div>
    </div>
  </div>
  <h2>Sinopse...</h2>
  <div class="wp-content">
    <p>Após um cataclismo global &#8211; a Destruidora.</p>
  </div>
  <ul class='episodios'>
    <li class='mark-1' data-id='1'>
      <div class='imagen'><img src='https://image.tmdb.org/t/p/w154/ep1.jpg'></div>
      <div class='numerando'>1 - 1</div>
      <div style='display:none' class='epnumber'>1</div>
      <div class='episodiotitle'>
        <a href='https://topanimes.net/episodio/avatar-seven-havens-episodio-1/'>Episódio 1</a>
      </div>
    </li>
    <li class='mark-2' data-id='2'>
      <div class='numerando'>1 - 2</div>
      <div style='display:none' class='epnumber'>2</div>
      <div class='episodiotitle'>
        <a href='https://topanimes.net/episodio/avatar-seven-havens-episodio-2/'>Episódio 2</a>
      </div>
    </li>
  </ul>
`;

describe('parseTopanimesCatalog', () => {
  it('lê os episódios da listagem (aspas simples)', () => {
    const catalog = parseTopanimesCatalog(HTML);
    expect(catalog.episodes).toEqual([
      {
        season: 1,
        episode: 1,
        url: 'https://topanimes.net/episodio/avatar-seven-havens-episodio-1/',
      },
      {
        season: 1,
        episode: 2,
        url: 'https://topanimes.net/episodio/avatar-seven-havens-episodio-2/',
      },
    ]);
  });

  it('lê metadados da página', () => {
    const catalog = parseTopanimesCatalog(HTML);
    expect(catalog.title).toBe('Avatar: Seven Havens');
    expect(catalog.poster).toBe('https://image.tmdb.org/t/p/w500/poster.jpg');
    expect(catalog.synopsis).toBe('Após um cataclismo global – a Destruidora.');
    expect(catalog.genres).toEqual(['Ação', 'Fantasia']);
  });

  it('devolve lista vazia quando a página não tem episódios', () => {
    const catalog = parseTopanimesCatalog('<html><body>empty</body></html>');
    expect(catalog.episodes).toEqual([]);
    expect(catalog.title).toBeNull();
  });
});
