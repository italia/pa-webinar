// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { NextResponse } from 'next/server';

import { generateOpenApiSpec } from '@/lib/openapi/generate';

export const dynamic = 'force-dynamic';

export function GET() {
  const spec = generateOpenApiSpec();

  return NextResponse.json(spec, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
