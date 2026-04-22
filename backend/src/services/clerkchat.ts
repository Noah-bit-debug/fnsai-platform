import axios, { AxiosInstance } from 'axios';
import dns from 'dns';

// Railway's default DNS resolver prefers IPv6 and Node 17+ defaults to
// 'verbatim' order, which means we try IPv6 first and wait for IPv4
// failover. api.clerkchat.com doesn't have AAAA records / flaky ones,
// so IPv6 attempts time out or return EAI_AGAIN. Force IPv4 first.
try { dns.setDefaultResultOrder('ipv4first'); } catch { /* older node */ }

// Wrap any network op with exponential backoff for transient DNS errors.
// EAI_AGAIN / ENOTFOUND / ETIMEDOUT / ECONNRESET are the errors Railway
// hits most often when ClerkChat's DNS is cold; they almost always
// resolve on retry 2 of 3.
async function withRetry<T>(op: () => Promise<T>, attempts = 3): Promise<T> {
  const transient = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED']);
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as { code?: string }).code;
      const isLast = i === attempts - 1;
      if (isLast || !code || !transient.has(code)) throw err;
      const wait = 200 * Math.pow(2, i);  // 200ms, 400ms, 800ms
      console.warn(`[clerkchat] transient ${code}, retry ${i + 1}/${attempts - 1} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // unreachable — the loop either returns or throws — but TypeScript needs it
  throw new Error('unreachable');
}

function getClerkChatClient(): AxiosInstance {
  const baseURL = process.env.CLERKCHAT_BASE_URL ?? 'https://api.clerkchat.com/v1';
  const apiKey = process.env.CLERKCHAT_API_KEY;

  if (!apiKey) {
    throw new Error('CLERKCHAT_API_KEY not configured');
  }

  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
}

export interface SMSSendResult {
  messageId: string;
  status: string;
  to: string;
}

export async function sendSMS(to: string, message: string): Promise<SMSSendResult> {
  const client = getClerkChatClient();
  const from = process.env.CLERKCHAT_FROM_NUMBER;

  if (!from) {
    throw new Error('CLERKCHAT_FROM_NUMBER not configured');
  }

  try {
    const response = await withRetry(() => client.post<SMSSendResult>('/messages', {
      from,
      to,
      body: message,
    }));

    return response.data;
  } catch (err) {
    // Surface the actual ClerkChat error instead of a generic wrapper.
    // Network errors (EAI_AGAIN etc) have err.code; HTTP errors have
    // err.response.status. Show whichever is present.
    const axiosErr = err as {
      response?: { status?: number; data?: { error?: string; message?: string } };
      message?: string;
      code?: string;
    };
    const providerMsg = axiosErr.response?.data?.error
      ?? axiosErr.response?.data?.message
      ?? axiosErr.message
      ?? 'unknown error';
    const identifier = axiosErr.response?.status
      ? `HTTP ${axiosErr.response.status}`
      : (axiosErr.code ?? 'error');  // shows "EAI_AGAIN" instead of "???"
    console.error('ClerkChat sendSMS error:', { to, identifier, providerMsg, data: axiosErr.response?.data });
    throw new Error(`ClerkChat ${identifier}: ${providerMsg}`);
  }
}

export async function sendApprovalRequest(
  to: string,
  subject: string,
  details: string,
  referenceId: string
): Promise<SMSSendResult> {
  const message =
    `FRONTLINE HEALTHCARE STAFFING - Action Required\n\n` +
    `📋 ${subject}\n\n` +
    `${details}\n\n` +
    `Ref: ${referenceId}\n\n` +
    `Reply A to APPROVE or D to DENY\n` +
    `This request expires in 24 hours.`;

  return sendSMS(to, message);
}

export interface ScheduledSMSResult {
  scheduledId: string;
  scheduledFor: string;
}

export async function scheduleFollowUp(
  to: string,
  message: string,
  delayHours: number
): Promise<ScheduledSMSResult> {
  const client = getClerkChatClient();
  const from = process.env.CLERKCHAT_FROM_NUMBER;

  if (!from) {
    throw new Error('CLERKCHAT_FROM_NUMBER not configured');
  }

  const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();

  try {
    const response = await withRetry(() => client.post<ScheduledSMSResult>('/messages/schedule', {
      from,
      to,
      body: message,
      sendAt: scheduledFor,
    }));

    return response.data;
  } catch (err) {
    console.error('ClerkChat scheduleFollowUp error:', err);
    throw new Error(`Failed to schedule follow-up SMS to ${to}`);
  }
}
