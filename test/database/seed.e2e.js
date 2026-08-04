
      const { PrismaClient } = require('@prisma/client');
      const bcrypt = require('bcrypt');

      async function seed() {
        const prisma = new PrismaClient();
        try {
          const adminPassword = await bcrypt.hash('Admin123!', 10);
          const userPassword = await bcrypt.hash('User123!', 10);

          await prisma.user.upsert({
            where: { email: 'admin@example.com' },
            update: {},
            create: {
              id: '1',
              email: 'admin@example.com',
              password: adminPassword,
              name: 'Admin User',
              role: 'ADMIN',
            },
          });

          await prisma.user.upsert({
            where: { email: 'user@example.com' },
            update: {},
            create: {
              id: '2',
              email: 'user@example.com',
              password: userPassword,
              name: 'Regular User',
              role: 'USER',
            },
          });

          console.log('Database seeded successfully!');
          console.log('Admin: admin@example.com / Admin123!');
          console.log('User: user@example.com / User123!');
        } catch (error) {
          console.error('Seeding failed:', error);
          throw error;
        } finally {
          await prisma.$disconnect();
        }
      }

      seed();
    