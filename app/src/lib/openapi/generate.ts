import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  createEventSchema,
  updateEventSchema,
  createInstantCallSchema,
  createRegistrationSchema,
  createQuestionSchema,
  updateQuestionStatusSchema,
  jitsiTokenRequestSchema,
  createPollSchema,
  updatePollStatusSchema,
  pollVoteSchema,
  createMaterialSchema,
  createReminderSchema,
  createFeedbackSchema,
  createWordCloudRoundSchema,
  submitWordCloudSchema,
  timerActionSchema,
  sendReactionSchema,
} from '@/lib/validation/schemas';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const bearerAuth = registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'CRON_API_KEY for metrics and cron endpoints',
});

const cookieAuth = registry.registerComponent('securitySchemes', 'AdminSession', {
  type: 'apiKey',
  in: 'cookie',
  name: 'admin_session',
  description: 'Admin JWT session cookie',
});

const moderatorToken = registry.registerComponent('securitySchemes', 'ModeratorToken', {
  type: 'apiKey',
  in: 'query',
  name: 'token',
  description: 'UUID moderator token for event management',
});

const paramSlugOrId = registry.registerComponent('parameters', 'eventParam', {
  name: 'param',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Event slug or UUID',
});

registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['System'],
  summary: 'Liveness probe',
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: z.object({ status: z.string(), timestamp: z.string(), version: z.string() }) } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/ready',
  tags: ['System'],
  summary: 'Readiness probe (verifies DB schema)',
  responses: {
    200: { description: 'Ready' },
    503: { description: 'Not ready' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/metrics',
  tags: ['System'],
  summary: 'Prometheus metrics endpoint',
  security: [{ [bearerAuth.name]: [] }],
  responses: { 200: { description: 'Prometheus text exposition', content: { 'text/plain': { schema: z.string() } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/status',
  tags: ['Status'],
  summary: 'Public system status',
  responses: { 200: { description: 'System status with component health, metrics, upcoming events' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/status/infrastructure',
  tags: ['Status'],
  summary: 'Infrastructure map data',
  responses: { 200: { description: 'Detailed infrastructure topology, service status, Prometheus data' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/status/metrics',
  tags: ['Status'],
  summary: 'Public Prometheus metric queries (predefined)',
  request: { query: z.object({ metric: z.enum(['uptime', 'responseTime', 'participants', 'conferences', 'stress']), hours: z.string().optional() }) },
  responses: { 200: { description: 'Time series data' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events',
  tags: ['Events'],
  summary: 'List events (public or moderator view)',
  responses: { 200: { description: 'Array of event summaries' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events',
  tags: ['Events'],
  summary: 'Create a new event',
  security: [{ [cookieAuth.name]: [] }],
  request: { body: { content: { 'application/json': { schema: createEventSchema } } } },
  responses: { 201: { description: 'Event created with moderator link' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/instant',
  tags: ['Events'],
  summary: 'Create an instant live videocall',
  security: [{ [cookieAuth.name]: [] }],
  request: { body: { content: { 'application/json': { schema: createInstantCallSchema } } } },
  responses: { 201: { description: 'Instant call created with live room link' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/calendar',
  tags: ['Events'],
  summary: 'Calendar feed (JSON)',
  request: { query: z.object({ start: z.string().optional(), end: z.string().optional(), mode: z.enum(['public', 'admin']).optional() }) },
  responses: { 200: { description: 'Array of calendar events' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}',
  tags: ['Events'],
  summary: 'Get event detail',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Full event object' } },
});

registry.registerPath({
  method: 'put',
  path: '/api/events/{param}',
  tags: ['Events'],
  summary: 'Update event',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: updateEventSchema } } } },
  responses: { 200: { description: 'Updated event' } },
});

registry.registerPath({
  method: 'delete',
  path: '/api/events/{param}',
  tags: ['Events'],
  summary: 'Delete event',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Event deleted' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/registrations',
  tags: ['Registration'],
  summary: 'Register for an event',
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: createRegistrationSchema } } } },
  responses: { 201: { description: 'Registration created with access token and join URL' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/registrations/{accessToken}',
  tags: ['Registration'],
  summary: 'Lookup registration by access token',
  request: { params: z.object({ param: z.string(), accessToken: z.string() }) },
  responses: { 200: { description: 'Registration summary' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/jitsi/token',
  tags: ['Jitsi'],
  summary: 'Get Jitsi JWT for room join',
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: jitsiTokenRequestSchema } } } },
  responses: { 200: { description: 'JWT token, room name, display name, role' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/questions',
  tags: ['Q&A'],
  summary: 'List questions',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Questions array with upvote counts' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/questions',
  tags: ['Q&A'],
  summary: 'Submit a question',
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: createQuestionSchema } } } },
  responses: { 201: { description: 'Question created' } },
});

registry.registerPath({
  method: 'patch',
  path: '/api/events/{param}/questions/{id}',
  tags: ['Q&A'],
  summary: 'Update question status (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string(), id: z.string() }), body: { content: { 'application/json': { schema: updateQuestionStatusSchema } } } },
  responses: { 200: { description: 'Updated question' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/questions/{id}/upvote',
  tags: ['Q&A'],
  summary: 'Toggle upvote on a question',
  request: { params: z.object({ param: z.string(), id: z.string() }) },
  responses: { 200: { description: 'Upvote toggled' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/polls',
  tags: ['Polls'],
  summary: 'List polls with vote tallies',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Polls array' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/polls',
  tags: ['Polls'],
  summary: 'Create a poll (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: createPollSchema } } } },
  responses: { 201: { description: 'Poll created' } },
});

registry.registerPath({
  method: 'patch',
  path: '/api/events/{param}/polls/{id}',
  tags: ['Polls'],
  summary: 'Update poll status (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string(), id: z.string() }), body: { content: { 'application/json': { schema: updatePollStatusSchema } } } },
  responses: { 200: { description: 'Updated poll' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/polls/{id}/vote',
  tags: ['Polls'],
  summary: 'Cast vote on a poll',
  request: { params: z.object({ param: z.string(), id: z.string() }), body: { content: { 'application/json': { schema: pollVoteSchema } } } },
  responses: { 201: { description: 'Vote recorded' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/materials',
  tags: ['Materials'],
  summary: 'List event materials',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Materials array' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/materials',
  tags: ['Materials'],
  summary: 'Add a link material (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: createMaterialSchema } } } },
  responses: { 201: { description: 'Material created' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/feedback',
  tags: ['Feedback'],
  summary: 'Get feedback summary or list',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Feedback summary with average rating and distribution' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/feedback',
  tags: ['Feedback'],
  summary: 'Submit event feedback',
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: createFeedbackSchema } } } },
  responses: { 201: { description: 'Feedback submitted' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/reactions',
  tags: ['Reactions'],
  summary: 'Send emoji reaction',
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: sendReactionSchema } } } },
  responses: { 200: { description: 'Reaction counted' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/reactions',
  tags: ['Reactions'],
  summary: 'Get reaction counts',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Reaction counts by emoji' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/reminders',
  tags: ['Reminders'],
  summary: 'List reminders (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Reminders array' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/reminders',
  tags: ['Reminders'],
  summary: 'Create a reminder (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: createReminderSchema } } } },
  responses: { 201: { description: 'Reminder created' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/wordcloud',
  tags: ['WordCloud'],
  summary: 'Create a word cloud round (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: createWordCloudRoundSchema } } } },
  responses: { 201: { description: 'Word cloud round started' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/wordcloud',
  tags: ['WordCloud'],
  summary: 'Get active word cloud round',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Active round with word aggregates' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/wordcloud/{id}/submit',
  tags: ['WordCloud'],
  summary: 'Submit a word',
  request: { params: z.object({ param: z.string(), id: z.string() }), body: { content: { 'application/json': { schema: submitWordCloudSchema } } } },
  responses: { 201: { description: 'Word submitted' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/timer',
  tags: ['Timer'],
  summary: 'Get timer state',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'Timer state' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/events/{param}/timer',
  tags: ['Timer'],
  summary: 'Control timer (moderator)',
  security: [{ [moderatorToken.name]: [] }],
  request: { params: z.object({ param: z.string() }), body: { content: { 'application/json': { schema: timerActionSchema } } } },
  responses: { 200: { description: 'Updated timer state' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/calendar.ics',
  tags: ['Events'],
  summary: 'Download iCal file for event',
  request: { params: z.object({ param: z.string() }) },
  responses: { 200: { description: 'iCal file', content: { 'text/calendar': { schema: z.string() } } } },
});

registry.registerPath({
  method: 'get',
  path: '/api/events/{param}/recording',
  tags: ['Recording'],
  summary: 'Redirect to recording URL',
  request: { params: z.object({ param: z.string() }) },
  responses: { 302: { description: 'Redirect to recording' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/login',
  tags: ['Admin'],
  summary: 'Admin login',
  request: { body: { content: { 'application/json': { schema: z.object({ key: z.string() }) } } } },
  responses: { 200: { description: 'Login successful, sets admin_session cookie' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/analytics',
  tags: ['Admin'],
  summary: 'Admin analytics dashboard data',
  security: [{ [cookieAuth.name]: [] }],
  responses: { 200: { description: 'Analytics overview, timeline, top events' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/settings',
  tags: ['Admin'],
  summary: 'Get site settings',
  responses: { 200: { description: 'Site settings (redacted if not admin)' } },
});

registry.registerPath({
  method: 'put',
  path: '/api/admin/settings',
  tags: ['Admin'],
  summary: 'Update site settings',
  security: [{ [cookieAuth.name]: [] }],
  responses: { 200: { description: 'Updated settings' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/admin/metrics/query',
  tags: ['Admin'],
  summary: 'Prometheus PromQL proxy',
  security: [{ [cookieAuth.name]: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ query: z.string(), start: z.string().optional(), end: z.string().optional(), step: z.string().optional() }) } } } },
  responses: { 200: { description: 'Prometheus query result' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/gdpr/export/request',
  tags: ['GDPR'],
  summary: 'Request a GDPR data-export link (Art. 15, step 1)',
  request: { body: { content: { 'application/json': { schema: z.object({ email: z.string().email(), locale: z.string().min(2).max(5).optional() }) } } } },
  responses: { 200: { description: 'Request accepted (an email is sent if the address matches a registration)' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/gdpr/export',
  tags: ['GDPR'],
  summary: 'Fulfil a GDPR data export via signed token (Art. 15, step 2)',
  request: { query: z.object({ t: z.string() }) },
  responses: { 200: { description: 'Exported personal data' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/recording',
  tags: ['Webhooks'],
  summary: 'Jibri recording finalize webhook',
  security: [{ [bearerAuth.name]: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ roomName: z.string(), recordingUrl: z.string().url() }) } } } },
  responses: { 200: { description: 'Recording URL stored' } },
});

registry.registerPath({
  method: 'get',
  path: '/api/organizations/suggestions',
  tags: ['Utilities'],
  summary: 'Organization name autocomplete',
  request: { query: z.object({ q: z.string() }) },
  responses: { 200: { description: 'Suggestions array' } },
});

const _paramRef = paramSlugOrId;

export function generateOpenApiSpec(): object {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'eventi-dtd API',
      version: process.env.npm_package_version || '0.1.0',
      description: 'REST API for the eventi-dtd public event platform. Supports event management, registration, live interaction (Q&A, polls, word cloud, reactions), recording, and administration.',
      license: { name: 'EUPL-1.2', url: 'https://opensource.org/licenses/EUPL-1.2' },
      contact: { name: 'GitHub', url: 'https://github.com/italia/eventi-dtd' },
    },
    servers: [
      { url: process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000', description: 'Current instance' },
    ],
    tags: [
      { name: 'System', description: 'Health checks, metrics, readiness' },
      { name: 'Status', description: 'Public status page data' },
      { name: 'Events', description: 'Event CRUD and listing' },
      { name: 'Registration', description: 'Participant registration' },
      { name: 'Jitsi', description: 'Jitsi JWT token generation' },
      { name: 'Q&A', description: 'Live Q&A with upvoting' },
      { name: 'Polls', description: 'Live polls with voting' },
      { name: 'Materials', description: 'Event materials and files' },
      { name: 'Feedback', description: 'Post-event feedback' },
      { name: 'Reactions', description: 'Live emoji reactions' },
      { name: 'Reminders', description: 'Email reminders' },
      { name: 'WordCloud', description: 'Live word cloud rounds' },
      { name: 'Timer', description: 'Server-side timer' },
      { name: 'Recording', description: 'Video recording management' },
      { name: 'Admin', description: 'Admin panel operations' },
      { name: 'GDPR', description: 'GDPR data export' },
      { name: 'Webhooks', description: 'External service webhooks' },
      { name: 'Utilities', description: 'Autocomplete and helpers' },
    ],
  });
}
