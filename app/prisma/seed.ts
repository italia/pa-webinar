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
  await prisma.gdprAuditLog.deleteMany();
  await prisma.reminderSent.deleteMany();
  await prisma.eventReminder.deleteMany();
  await prisma.pollVote.deleteMany();
  await prisma.poll.deleteMany();
  await prisma.eventMaterial.deleteMany();
  await prisma.questionUpvote.deleteMany();
  await prisma.question.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.event.deleteMany();
  // System templates are created by migration; only delete user-created ones during seed
  await prisma.eventTemplate.deleteMany({ where: { isSystem: false } });

  // Ensure system templates exist (idempotent — migration handles this, seed is a safety net)
  const systemTemplates = [
    {
      name: 'Webinar',
      description:
        'Presentazione pubblica con molti partecipanti. Solo ascolto, Q&A attivo, nessuna webcam partecipanti.',
      icon: 'it-presentation',
      qaEnabled: true,
      chatEnabled: false,
      recordingEnabled: false,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
      maxParticipants: 300,
      isSystem: true,
      sortOrder: 0,
    },
    {
      name: 'Community interattiva',
      description:
        'Evento partecipativo con chat, Q&A e possibilità per tutti di parlare e mostrare la webcam.',
      icon: 'it-team-digitale',
      qaEnabled: true,
      chatEnabled: true,
      recordingEnabled: false,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
      participantsCanShareScreen: false,
      maxParticipants: 50,
      isSystem: true,
      sortOrder: 1,
    },
    {
      name: 'Videocall tra colleghi',
      description:
        'Riunione interna con pochi partecipanti. Tutti possono parlare, condividere schermo e usare la webcam.',
      icon: 'it-video',
      qaEnabled: false,
      chatEnabled: true,
      recordingEnabled: false,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
      participantsCanShareScreen: true,
      maxParticipants: 20,
      isSystem: true,
      sortOrder: 2,
    },
    {
      name: 'Presentazione pubblica',
      description:
        'Evento pubblico con registrazione video e condivisione schermo del relatore. Q&A attivo.',
      icon: 'it-camera',
      qaEnabled: true,
      chatEnabled: false,
      recordingEnabled: true,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
      maxParticipants: 300,
      isSystem: true,
      sortOrder: 3,
    },
  ];
  for (const tmpl of systemTemplates) {
    const existing = await prisma.eventTemplate.findFirst({
      where: { name: tmpl.name, isSystem: true },
    });
    if (!existing) {
      await prisma.eventTemplate.create({ data: tmpl });
    }
  }
  console.log('System event templates ensured.');

  // Seed site settings
  await prisma.siteSetting.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      siteName: 'Eventi PA',
      siteDescription:
        'Piattaforma per eventi pubblici digitali della Pubblica Amministrazione',
      organizationName: 'Nome Ente',
      organizationNameShort: 'Ente',
      organizationUrl: 'https://www.example.gov.it',
      parentOrganization: 'Organizzazione superiore',
      parentOrganizationUrl: 'https://www.governo.it',
      homePageMode: 'LANDING',
      statusPageEnabled: true,
      guestAccessEnabled: true,
      publicRegistrationEnabled: true,
      footerLinks: JSON.stringify([
        { title: 'Privacy', url: '/privacy', section: 'legal' },
        { title: 'Accessibilità', url: '/accessibilita', section: 'legal' },
        { title: 'Note legali', url: '/note-legali', section: 'legal' },
      ]),
    },
  });
  console.log('Seeded site settings.');

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
      participantsCanUnmute: false,
      participantsCanStartVideo: true,
      participantsCanShareScreen: false,
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

  // Add default reminders to events
  for (const evt of [event1, event2, event3]) {
    await prisma.eventReminder.createMany({
      data: [
        { eventId: evt.id, offsetMinutes: 1440, label: '1 giorno prima' },
        { eventId: evt.id, offsetMinutes: 60, label: '1 ora prima' },
      ],
    });
  }

  // Add sample materials to the ended event
  await prisma.eventMaterial.createMany({
    data: [
      {
        eventId: event3.id,
        title: 'Slide del workshop — Design System .italia',
        url: 'https://docs.google.com/presentation/d/example-1',
        description: 'Slide della presentazione principale del workshop.',
        addedBy: 'Luca Verdi',
      },
      {
        eventId: event3.id,
        title: 'Documentazione Bootstrap Italia',
        url: 'https://italia.github.io/bootstrap-italia/',
        description: 'Riferimento ufficiale per il design system .italia.',
        addedBy: 'Luca Verdi',
      },
      {
        eventId: event3.id,
        title: 'Repository Design React Kit',
        url: 'https://github.com/italia/design-react-kit',
        addedBy: 'Francesca Russo',
      },
    ],
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
