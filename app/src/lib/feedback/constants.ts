/**
 * Shared constants for the post-event feedback subsystem.
 *
 * The post-event feedback experience is built on the questionnaire
 * subsystem: a POST_EVENT EventQuestionnaire composed of the system
 * "Feedback generico" QuestionTemplate (seeded via migration
 * 20260617000000_feedback_generic_template) plus any per-event custom
 * questions. New events get this template auto-attached by default unless
 * feedback collection is disabled.
 */

/** Unique name of the seeded system feedback template (see migration). */
export const FEEDBACK_GENERIC_TEMPLATE_NAME = 'Feedback generico';
