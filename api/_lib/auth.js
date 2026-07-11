import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
  }
  return secret;
}

function sign(value) {
  return createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function createSession({ role, court = null }) {
  const now = Date.now();
  const payload = {
    v: 1,
    role,
    court,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;

  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.v !== 1 || !payload.role || !payload.exp || payload.exp <= Date.now()) {
      return null;
    }
    if (payload.role === 'court' && ![1, 2, 3, 4].includes(Number(payload.court))) {
      return null;
    }
    if (payload.role !== 'court' && payload.role !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return verifySession(match?.[1] || '');
}

export function getExpectedPin(requestedCourt) {
  if (requestedCourt === 'admin') return process.env.ADMIN_PIN;
  const court = Number(requestedCourt);
  if (![1, 2, 3, 4].includes(court)) return null;
  return process.env[`COURT_${court}_PIN`];
}

export function validatePin(requestedCourt, submittedPin) {
  const expectedPin = getExpectedPin(requestedCourt);
  if (!expectedPin) {
    throw new Error(`PIN configuration is missing for ${requestedCourt}.`);
  }
  return safeEqual(String(submittedPin || ''), String(expectedPin));
}

export function canModifyCourt(session, court) {
  return session?.role === 'admin' || (
    session?.role === 'court' && Number(session.court) === Number(court)
  );
}
