import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";

const sessionCookieName = "treasury_operator_session";

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sessionKey() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }

  return new TextEncoder().encode(secret);
}

export function verifyOperatorPassword(candidate: string) {
  const expected = process.env.OPERATOR_PASSWORD;
  return Boolean(expected && safeEqual(candidate, expected));
}

export async function createOperatorSession() {
  const token = await new SignJWT({ role: "operator" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("portfolio-operator")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(sessionKey());

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearOperatorSession() {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
}

export async function getOperatorSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, sessionKey());
    return payload.role === "operator" && payload.sub
      ? { actorId: payload.sub, role: "operator" as const }
      : null;
  } catch {
    return null;
  }
}

export async function requireOperatorPage() {
  const session = await getOperatorSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireOperatorApi() {
  return getOperatorSession();
}

export function verifyAgentRequest(request: Request) {
  const expected = process.env.AGENT_SERVICE_TOKEN;
  const authorization = request.headers.get("authorization");

  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice("Bearer ".length), expected);
}
