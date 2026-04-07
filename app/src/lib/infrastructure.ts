let jibriAvailable: boolean | null = null;
let jibriCheckExpiry = 0;

export async function isJibriAvailable(): Promise<boolean> {
  if (jibriAvailable !== null && Date.now() < jibriCheckExpiry) {
    return jibriAvailable;
  }

  const storageType = process.env.RECORDING_STORAGE_TYPE;
  jibriAvailable = !!storageType && storageType !== 'local';
  jibriCheckExpiry = Date.now() + 300_000;

  return jibriAvailable;
}

export interface InfrastructureInfo {
  deployment: {
    mode: 'simple' | 'standard' | 'full' | 'unknown';
    version: string;
    nodeEnv: string;
  };
  database: {
    type: 'internal' | 'external';
    host: string;
    connected: boolean;
  };
  jitsi: {
    domain: string;
    reachable: boolean;
    jwtConfigured: boolean;
  };
  jvb: {
    desiredReplicas: number;
    maxReplicas: number;
    preScaleMinutes: number;
    scalerEnabled: boolean;
  };
  jibri: {
    available: boolean;
    storageType: string;
    storageConfigured: boolean;
  };
  email: {
    provider: string;
    configured: boolean;
  };
  storage: {
    recordings: string;
  };
  features: {
    statusPage: boolean;
    guestAccess: boolean;
    metricsEndpoint: boolean;
  };
}

function inferDeploymentMode(): InfrastructureInfo['deployment']['mode'] {
  if (process.env.KUBERNETES_SERVICE_HOST) {
    const maxReplicas = parseInt(process.env.JVB_MAX_REPLICAS || '0', 10);
    return maxReplicas > 1 ? 'full' : 'standard';
  }
  return 'simple';
}

function inferEmailProvider(host: string): string {
  if (!host) return 'none';
  const h = host.toLowerCase();
  if (h.includes('mailgun')) return 'Mailgun';
  if (h.includes('sendgrid')) return 'SendGrid';
  if (h.includes('communication.azure')) return 'Azure Communication Services';
  if (h.includes('ses.')) return 'Amazon SES';
  if (h.includes('mailpit') || h.includes('localhost')) return 'Mailpit (dev)';
  return 'SMTP';
}

export async function getInfrastructureInfo(): Promise<InfrastructureInfo> {
  const dbUrl = process.env.DATABASE_URL || '';
  let dbHost = '';
  let dbType: 'internal' | 'external' = 'internal';
  try {
    const parsed = new URL(dbUrl);
    dbHost = parsed.hostname;
    dbType = dbHost.includes('postgres') && !dbHost.includes('.') ? 'internal' : 'external';
  } catch {
    // invalid URL
  }

  let dbConnected = false;
  try {
    const { prisma } = await import('@/lib/db');
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {
    // can't connect
  }

  const jitsiDomain = process.env.NEXT_PUBLIC_JITSI_DOMAIN || '';
  let jitsiReachable = false;
  if (jitsiDomain) {
    try {
      const res = await fetch(`https://${jitsiDomain}/http-bind`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      jitsiReachable = res.ok || res.status === 405;
    } catch {
      // not reachable
    }
  }

  const smtpHost = process.env.SMTP_HOST || '';
  const storageType = process.env.RECORDING_STORAGE_TYPE || 'not-configured';

  return {
    deployment: {
      mode: inferDeploymentMode(),
      version: process.env.npm_package_version || process.env.APP_VERSION || '0.0.0',
      nodeEnv: process.env.NODE_ENV || 'development',
    },
    database: {
      type: dbType,
      host: dbHost,
      connected: dbConnected,
    },
    jitsi: {
      domain: jitsiDomain,
      reachable: jitsiReachable,
      jwtConfigured: !!(process.env.JITSI_JWT_SECRET || process.env.JWT_SECRET),
    },
    jvb: {
      desiredReplicas: parseInt(process.env.JVB_DESIRED_REPLICAS || '0', 10),
      maxReplicas: parseInt(process.env.JVB_MAX_REPLICAS || '0', 10),
      preScaleMinutes: parseInt(process.env.JVB_PRE_SCALE_MINUTES || '30', 10),
      scalerEnabled: parseInt(process.env.JVB_MAX_REPLICAS || '0', 10) > 0,
    },
    jibri: {
      available: await isJibriAvailable(),
      storageType,
      storageConfigured: storageType !== 'not-configured' && storageType !== 'local',
    },
    email: {
      provider: inferEmailProvider(smtpHost),
      configured: !!smtpHost,
    },
    storage: {
      recordings: storageType,
    },
    features: {
      statusPage: true,
      guestAccess: process.env.NEXT_PUBLIC_GUEST_ACCESS !== 'false',
      metricsEndpoint: process.env.METRICS_ENABLED !== 'false',
    },
  };
}
