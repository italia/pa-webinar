import { jwtVerify } from 'jose';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

const SECRET = new TextEncoder().encode(
  process.env.APP_SECRET ?? 'dev-secret-change-me',
);

export async function isAdminAuthenticated(
  cookies: ReadonlyRequestCookies,
): Promise<boolean> {
  const token = cookies.get('admin_session')?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}
