// Custom error classes for consistent API error handling

export class AppError extends Error {
  public headers?: Record<string, string>;

  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds?: number) {
    super('Too many requests', 429, 'RATE_LIMIT');
    if (retryAfterSeconds !== undefined) {
      this.headers = {
        'Retry-After': String(Math.ceil(retryAfterSeconds)),
      };
    }
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const includeDetails =
      error.code === 'VALIDATION_ERROR' ||
      process.env.NODE_ENV === 'development';
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details && includeDetails ? { details: error.details } : {}),
      },
      { status: error.statusCode, headers: error.headers }
    );
  }

  // Prisma errors
  if (error && typeof error === 'object' && 'code' in error) {
    const prismaError = error as { code: string; meta?: unknown };
    if (prismaError.code === 'P2002') {
      return Response.json(
        { error: 'Resource already exists', code: 'CONFLICT' },
        { status: 409 }
      );
    }
    if (prismaError.code === 'P2025') {
      return Response.json(
        { error: 'Resource not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }
  }

  // Zod validation errors
  if (error && typeof error === 'object' && 'issues' in error) {
    return Response.json(
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        issues: (error as { issues: unknown[] }).issues,
      },
      { status: 422 }
    );
  }

  // Unknown errors — log but don't expose details
  console.error('Unhandled error:', error);
  return Response.json(
    { error: 'Internal server error', code: 'INTERNAL_ERROR' },
    { status: 500 }
  );
}
