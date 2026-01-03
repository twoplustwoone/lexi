import { Env } from '../env';

export async function sendSmsCode(env: Env, phone: string, code: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const body = new URLSearchParams({
    To: phone,
    From: env.TWILIO_FROM,
    Body: `Your Word of the Day code is ${code}. It expires in 10 minutes.`,
  });
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SMS provider error: ${response.status} ${text}`);
  }
}
