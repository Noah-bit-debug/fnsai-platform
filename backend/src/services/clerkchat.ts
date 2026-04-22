import axios, { AxiosInstance } from 'axios';

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
    const response = await client.post<SMSSendResult>('/messages', {
      from,
      to,
      body: message,
    });

    return response.data;
  } catch (err) {
    // Surface the actual ClerkChat error instead of a generic wrapper.
    // Previous "Failed to send SMS to X" hid the real cause (invalid from
    // number, bad API key, destination rejected, E.164 format wrong, etc).
    const axiosErr = err as { response?: { status?: number; data?: { error?: string; message?: string } }; message?: string };
    const providerMsg = axiosErr.response?.data?.error
      ?? axiosErr.response?.data?.message
      ?? axiosErr.message
      ?? 'unknown error';
    const status = axiosErr.response?.status;
    console.error('ClerkChat sendSMS error:', { to, status, providerMsg, data: axiosErr.response?.data });
    throw new Error(`ClerkChat ${status ?? '???'}: ${providerMsg}`);
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
    const response = await client.post<ScheduledSMSResult>('/messages/schedule', {
      from,
      to,
      body: message,
      sendAt: scheduledFor,
    });

    return response.data;
  } catch (err) {
    console.error('ClerkChat scheduleFollowUp error:', err);
    throw new Error(`Failed to schedule follow-up SMS to ${to}`);
  }
}
