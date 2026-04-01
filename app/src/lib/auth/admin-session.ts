import { jwtVerify } from 'jose';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

export async function isAdminAuthenticated(
  cookies: ReadonlyRequestCookies,
): Promise<boolean> {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) return false;

  const token = cookies.get('admin_session')?.value;
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(appSecret);
    const { payload } = await jwtVerify(token, secret);
    return payload.role === 'admin';
  } catch {
    return false;
  }
}
