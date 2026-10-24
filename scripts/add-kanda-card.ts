import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { userName: { contains: 'iarley', mode: 'insensitive' } },
        { email: { contains: 'iarley', mode: 'insensitive' } },
      ],
    },
  });

  if (!user) {
    console.error('Usuário iarley não encontrado!');
    process.exit(1);
  }

  console.log(`Usuário encontrado: ${user.id} (${user.userName || user.email})`);

  // Check if card Kanda Yuu exists, else create it
  let card = await prisma.card.findFirst({
    where: { name: { contains: 'Kanda Yuu', mode: 'insensitive' } },
  });

  if (!card) {
    card = await prisma.card.create({
      data: {
        malCharacterId: 87, // Kanda Yuu MAL ID or unique fallback
        name: 'Kanda Yuu',
        rarity: 'EPICA',
        animeTitle: 'D.Gray-man',
        favourites: 5000,
      },
    });
    console.log(`Carta criada: ${card.id} - ${card.name}`);
  } else {
    console.log(`Carta já existe: ${card.id} - ${card.name}`);
    // Update rarity to EPICA just in case
    card = await prisma.card.update({
      where: { id: card.id },
      data: { rarity: 'EPICA' },
    });
  }

  // Find max edition for this card to set edition cleanly
  const lastUserCard = await prisma.userCard.findFirst({
    where: { cardId: card.id },
    orderBy: { edition: 'desc' },
  });
  const edition = (lastUserCard?.edition ?? 0) + 1;

  // Condition 0.9 corresponds to POOR (condition > 0.55)
  const condition = 0.9;
  const foil = 'HOLO';
  const value = 900;
  const rankedValue = 900;

  const userCard = await prisma.userCard.create({
    data: {
      userId: user.id,
      cardId: card.id,
      condition,
      foil,
      edition,
      value,
      rankedValue,
      valueOverride: value,
    },
  });

  console.log('Carta adicionada com sucesso para o usuário!');
  console.log(userCard);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
