/**
 * Prisma seed script — creates example data for local development.
 * Run with: npx prisma db seed (or npm run db:seed)
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clean existing data
  await prisma.questionUpvote.deleteMany();
  await prisma.question.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.event.deleteMany();

  // Create sample events
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowPlusTwo = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastWeekPlusTwo = new Date(lastWeek.getTime() + 2 * 60 * 60 * 1000);

  const event1 = await prisma.event.create({
    data: {
      slug: 'pa-digitale-2026-aggiornamenti',
      titleIt: 'PA Digitale 2026 — Aggiornamenti e prossimi passi',
      titleEn: 'PA Digitale 2026 — Updates and next steps',
      descriptionIt:
        'Webinar pubblico sugli aggiornamenti del piano PA Digitale 2026. Verranno presentati i risultati raggiunti e i prossimi obiettivi.',
      descriptionEn:
        'Public webinar on PA Digitale 2026 plan updates. Results achieved and upcoming goals will be presented.',
      startsAt: tomorrow,
      endsAt: tomorrowPlusTwo,
      maxParticipants: 300,
      jitsiRoomName: `evt-${randomUUID()}`,
      qaEnabled: true,
      chatEnabled: false,
      recordingEnabled: true,
      moderatorToken: randomUUID(),
      moderatorName: 'Mario Rossi',
      moderatorEmail: 'mario.rossi@innovazione.gov.it',
      speakersIt: 'Mario Rossi, Laura Bianchi, Giuseppe Verdi',
      speakersEn: 'Mario Rossi, Laura Bianchi, Giuseppe Verdi',
      organizerName: 'Dipartimento per la Trasformazione Digitale',
      status: 'PUBLISHED',
      dataRetentionDays: 30,
    },
  });

  const event2 = await prisma.event.create({
    data: {
      slug: 'cloud-italia-strategia',
      titleIt: 'Cloud Italia — Strategia e migrazione',
      titleEn: 'Cloud Italia — Strategy and migration',
      descriptionIt:
        'Presentazione della strategia Cloud Italia e dei percorsi di migrazione per le PA. Sessione di Q&A con il team tecnico.',
      descriptionEn:
        'Presentation of Cloud Italia strategy and migration paths for public administrations. Q&A session with the technical team.',
      startsAt: inOneHour,
      endsAt: inTwoHours,
      maxParticipants: 200,
      jitsiRoomName: `evt-${randomUUID()}`,
      qaEnabled: true,
      chatEnabled: true,
      recordingEnabled: false,
      moderatorToken: randomUUID(),
      moderatorName: 'Anna Bianchi',
      moderatorEmail: 'anna.bianchi@innovazione.gov.it',
      speakersIt: 'Anna Bianchi, Marco Neri',
      speakersEn: 'Anna Bianchi, Marco Neri',
      organizerName: 'Dipartimento per la Trasformazione Digitale',
      status: 'PUBLISHED',
      dataRetentionDays: 60,
    },
  });

  const event3 = await prisma.event.create({
    data: {
      slug: 'design-system-italia-workshop',
      titleIt: 'Workshop: Design System .italia per sviluppatori',
      titleEn: 'Workshop: .italia Design System for developers',
      descriptionIt:
        'Workshop pratico sull\'utilizzo del design system .italia e di Bootstrap Italia per lo sviluppo di servizi digitali della PA.',
      descriptionEn:
        'Hands-on workshop on using the .italia design system and Bootstrap Italia for developing PA digital services.',
      startsAt: lastWeek,
      endsAt: lastWeekPlusTwo,
      maxParticipants: 100,
      jitsiRoomName: `evt-${randomUUID()}`,
      qaEnabled: true,
      chatEnabled: false,
      recordingEnabled: true,
      moderatorToken: randomUUID(),
      moderatorName: 'Luca Verdi',
      speakersIt: 'Luca Verdi, Francesca Russo, Alessandro Conti',
      speakersEn: 'Luca Verdi, Francesca Russo, Alessandro Conti',
      organizerName: 'Dipartimento per la Trasformazione Digitale',
      status: 'ENDED',
      recordingUrl: 'https://example.com/recordings/design-system-workshop.mp4',
      dataRetentionDays: 90,
    },
  });

  // Log moderator links for testing
  console.log('\n--- Moderator Links (for testing) ---');
  console.log(
    `Event 1 (${event1.slug}): http://localhost:3000/it/admin/eventi/${event1.id}?token=${event1.moderatorToken}`
  );
  console.log(
    `Event 2 (${event2.slug}): http://localhost:3000/it/admin/eventi/${event2.id}?token=${event2.moderatorToken}`
  );
  console.log(
    `Event 3 (${event3.slug}): http://localhost:3000/it/admin/eventi/${event3.id}?token=${event3.moderatorToken}`
  );
  console.log('');

  console.log(`Seeded ${3} events.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
