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
  await prisma.questionGuestUpvote.deleteMany();
  await prisma.question.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.event.deleteMany();
  // System templates are created by migration; only delete user-created ones during seed
  await prisma.eventTemplate.deleteMany({ where: { isSystem: false } });

  // Ensure system templates exist (idempotent — migration handles this, seed is a safety net).
  // Gli stessi tre della migrazione 20261007150000_three_event_templates.
  const systemTemplates = [
    {
      name: 'Webinar pubblico',
      description:
        "Relatori in video e pubblico in ascolto, con la chat. La registrazione è disponibile e si avvia in sala. Fino a 300 partecipanti, un'ora.",
      icon: 'it-presentation',
      qaEnabled: false,
      chatEnabled: true,
      recordingEnabled: true,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
      maxParticipants: 300,
      defaultDurationMinutes: 60,
      postEventPublic: true,
      isSystem: true,
      sortOrder: 0,
    },
    {
      name: 'Riunione di lavoro',
      description:
        "Tutti possono parlare, usare la webcam e condividere lo schermo. Senza registrazione, e la pagina dopo l'evento non è pubblica. Fino a 20 partecipanti, un'ora.",
      icon: 'it-video',
      qaEnabled: false,
      chatEnabled: true,
      recordingEnabled: false,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
      participantsCanShareScreen: true,
      maxParticipants: 20,
      defaultDurationMinutes: 60,
      postEventPublic: false,
      isSystem: true,
      sortOrder: 1,
    },
    {
      name: 'Evento partecipativo',
      description:
        "Tutti possono parlare e usare la webcam; lo schermo lo condividono i relatori. Con la scaletta dell'incontro e le domande «In una parola». Fino a 50 partecipanti, un'ora e mezza.",
      icon: 'it-comment',
      qaEnabled: false,
      chatEnabled: true,
      recordingEnabled: false,
      agendaEnabled: true,
      wordCloudEnabled: true,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
      participantsCanShareScreen: false,
      maxParticipants: 50,
      defaultDurationMinutes: 90,
      postEventPublic: true,
      isSystem: true,
      sortOrder: 2,
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
      siteName: 'PA Webinar',
      siteDescription:
        'Webinar ed eventi pubblici delle community della trasformazione digitale',
      organizationName: '',
      organizationNameShort: '',
      organizationUrl: '',
      // Parent body shown in the .italia slim header. Left without a URL on
      // purpose: an unconfigured deploy shows the name as plain text rather
      // than linking out to an unrelated site.
      parentOrganization: '',
      parentOrganizationUrl: '',
      homePageMode: 'LANDING',
      statusPageEnabled: true,
      guestAccessEnabled: true,
      publicRegistrationEnabled: true,
      calendarPublic: true,
      // Un elenco, non un testo JSON: la colonna e' JSON, e le impostazioni
      // lette tornano indietro cosi' come sono quando si salva dal pannello.
      footerLinks: [
        { title: 'Privacy', url: '/privacy', section: 'legal' },
        { title: 'Accessibilità', url: '/accessibility', section: 'legal' },
        { title: 'Note legali', url: '/legal-notice', section: 'legal' },
      ],
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
      title: { it: 'PA Digitale 2026 — Aggiornamenti e prossimi passi', en: 'PA Digitale 2026 — Updates and next steps' },
      description: {
        it: 'Webinar pubblico sugli aggiornamenti del piano PA Digitale 2026. Verranno presentati i risultati raggiunti e i prossimi obiettivi.',
        en: 'Public webinar on PA Digitale 2026 plan updates. Results achieved and upcoming goals will be presented.',
      },
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
      moderatorEmail: 'mario.rossi@example.com',
      speakersInfo: { it: 'Mario Rossi, Laura Bianchi, Giuseppe Verdi', en: 'Mario Rossi, Laura Bianchi, Giuseppe Verdi' },
      organizerName: 'Ente di esempio',
      status: 'PUBLISHED',
      dataRetentionDays: 30,
    },
  });

  const event2 = await prisma.event.create({
    data: {
      slug: 'cloud-italia-strategia',
      title: { it: 'Cloud Italia — Strategia e migrazione', en: 'Cloud Italia — Strategy and migration' },
      description: {
        it: 'Presentazione della strategia Cloud Italia e dei percorsi di migrazione per le PA. Sessione di Q&A con il team tecnico.',
        en: 'Presentation of Cloud Italia strategy and migration paths for public administrations. Q&A session with the technical team.',
      },
      startsAt: inOneHour,
      endsAt: inTwoHours,
      maxParticipants: 200,
      jitsiRoomName: `evt-${randomUUID()}`,
      qaEnabled: true,
      chatEnabled: true,
      recordingEnabled: false,
      moderatorToken: randomUUID(),
      moderatorName: 'Anna Bianchi',
      moderatorEmail: 'anna.bianchi@example.com',
      speakersInfo: { it: 'Anna Bianchi, Marco Neri', en: 'Anna Bianchi, Marco Neri' },
      organizerName: 'Ente di esempio',
      status: 'PUBLISHED',
      dataRetentionDays: 60,
    },
  });

  const event3 = await prisma.event.create({
    data: {
      slug: 'design-system-italia-workshop',
      title: { it: 'Workshop: Design System .italia per sviluppatori', en: 'Workshop: .italia Design System for developers' },
      description: {
        it: 'Workshop pratico sull\'utilizzo del design system .italia e di Bootstrap Italia per lo sviluppo di servizi digitali della PA.',
        en: 'Hands-on workshop on using the .italia design system and Bootstrap Italia for developing PA digital services.',
      },
      startsAt: lastWeek,
      endsAt: lastWeekPlusTwo,
      maxParticipants: 100,
      jitsiRoomName: `evt-${randomUUID()}`,
      qaEnabled: true,
      chatEnabled: false,
      recordingEnabled: true,
      moderatorToken: randomUUID(),
      moderatorName: 'Luca Verdi',
      speakersInfo: { it: 'Luca Verdi, Francesca Russo, Alessandro Conti', en: 'Luca Verdi, Francesca Russo, Alessandro Conti' },
      organizerName: 'Ente di esempio',
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
