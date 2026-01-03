import { Env } from '../env';

export async function sendEmailCode(env: Env, email: string, code: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [email],
      subject: 'Your Word of the Day sign-in code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Email provider error: ${response.status} ${text}`);
  }
}
