import type { OrganizationType, Prisma, PrismaClient } from '@prisma/client';

export interface PersonUpsertInput {
  emailHash: string;
  displayName?: string | null;
  organization?: string | null;
  organizationRole?: string | null;
  organizationType?: OrganizationType | null;
  // true only when the participant ticked the dedicated rubrica checkbox
  // on the registration form (Art. 6.1.a opt-in).
  optedIn: boolean;
}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Upsert a Person row by emailHash and return its id.
 *
 * Behaviour:
 *   - If no Person exists and `optedIn` is false, no row is created —
 *     we never index contact data without explicit opt-in.
 *   - If a Person exists (from a prior opt-in) and `optedIn` is false,
 *     the row is left untouched (no profile refresh, no optedOutAt —
 *     "I don't want to opt in now" is not the same as "withdraw").
 *   - On opt-in (either first-time or subsequent) the latest stable
 *     profile fields are written, `lastActiveAt` is bumped, and any
 *     prior `optedOutAt` is cleared (the participant re-consented).
 *
 * Returns the Person id when a row was upserted, or null when the
 * participant is not opted in and no existing Person row exists.
 */
export async function upsertPersonOnRegistration(
  tx: Tx,
  input: PersonUpsertInput,
): Promise<string | null> {
  const existing = await tx.person.findUnique({
    where: { emailHash: input.emailHash },
    select: { id: true, optedInToAddressBook: true },
  });

  if (!existing && !input.optedIn) return null;

  const now = new Date();

  if (!existing) {
    const created = await tx.person.create({
      data: {
        emailHash: input.emailHash,
        displayName: input.displayName ?? null,
        organization: input.organization ?? null,
        organizationRole: input.organizationRole ?? null,
        organizationType: input.organizationType ?? null,
        optedInToAddressBook: true,
        optedInAt: now,
        lastActiveAt: now,
      },
      select: { id: true },
    });
    return created.id;
  }

  if (input.optedIn) {
    const updated = await tx.person.update({
      where: { id: existing.id },
      data: {
        displayName: input.displayName ?? null,
        organization: input.organization ?? null,
        organizationRole: input.organizationRole ?? null,
        organizationType: input.organizationType ?? null,
        optedInToAddressBook: true,
        optedInAt: existing.optedInToAddressBook ? undefined : now,
        optedOutAt: null,
        lastActiveAt: now,
      },
      select: { id: true },
    });
    return updated.id;
  }

  // Existing row, user did NOT re-opt-in this time: do not refresh
  // profile (we only refresh on opt-in), but still bump activity.
  await tx.person.update({
    where: { id: existing.id },
    data: { lastActiveAt: now },
  });
  return existing.id;
}
