import { notFound } from 'next/navigation';

import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';
import { prisma } from '@/lib/db';
import { findEventQuestionnaireByPlacement } from '@/lib/questionnaires';
import { QUESTIONNAIRE_PLACEMENTS } from '@/lib/validation/schemas';

interface PageProps {
  params: Promise<{ slug: string; placement: string; locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function PublicQuestionnairePage({ params, searchParams }: PageProps) {
  const { slug, placement: rawPlacement } = await params;
  const { token } = await searchParams;

  if (!(QUESTIONNAIRE_PLACEMENTS as readonly string[]).includes(rawPlacement)) {
    notFound();
  }
  const placement = rawPlacement as (typeof QUESTIONNAIRE_PLACEMENTS)[number];

  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!event) notFound();

  const q = await findEventQuestionnaireByPlacement(event.id, placement);
  if (!q) notFound();

  return (
    <div className="container py-5" style={{ maxWidth: 720 }}>
      <QuestionnaireForm
        eventSlug={event.slug}
        placement={placement}
        {...(token && { accessToken: token })}
      />
    </div>
  );
}
