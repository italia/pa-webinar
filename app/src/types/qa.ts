import type { Question, QuestionStatus, QuestionUpvote } from '@prisma/client';

/**
 * Question as returned to participants (includes upvote state).
 */
export interface PublicQuestion {
  id: string;
  authorName: string;
  text: string;
  status: QuestionStatus;
  upvoteCount: number;
  hasUpvoted: boolean; // whether the current participant has upvoted
  createdAt: string;
  highlightedAt: string | null;
  answeredAt: string | null;
}

/**
 * Q&A panel state for the live event room.
 */
export interface QAState {
  questions: PublicQuestion[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
}

export type { Question, QuestionStatus, QuestionUpvote };
