import { Env } from '../env';

export interface GoogleProfile {
  sub: string;
  email: string | null;
}

export async function verifyGoogleIdToken(env: Env, idToken: string): Promise<GoogleProfile> {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!response.ok) {
    throw new Error('Invalid Google token');
  }
  const data = (await response.json()) as {
    sub: string;
    email?: string;
    email_verified?: string;
    aud: string;
  };
  if (data.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error('Google token audience mismatch');
  }
  if (data.email_verified === 'false') {
    throw new Error('Google email not verified');
  }
  return { sub: data.sub, email: data.email ?? null };
}
