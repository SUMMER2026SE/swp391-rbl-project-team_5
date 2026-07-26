const AUTH_COOKIE_NAME = 'token';
const LEGACY_AUTH_COOKIE_NAME = 'vietticket_access_token';

function shouldUseSecureCookie() {
  return (
    process.env.NODE_ENV === 'production' ||
    String(process.env.COOKIE_SECURE || '').trim().toLowerCase() === 'true'
  );
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(LEGACY_AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    path: '/',
  });
}

module.exports = {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  setAuthCookie,
};
