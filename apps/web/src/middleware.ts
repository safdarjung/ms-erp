import { NextResponse, type NextRequest } from 'next/server';

// Rolling session: re-stamp the session cookie's lifetime on every request so an
// actively-used login never expires on this device (the DB session is likewise
// extended in getCurrentUser). Edge-safe — no DB access here, just the cookie.
const SESSION_COOKIE = 'ms_session';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days, refreshed each visit

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: MAX_AGE,
    });
  }
  return res;
}

// Run on app pages; skip static assets and Next internals.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
