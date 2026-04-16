import axios, { AxiosInstance } from 'axios';

function getFoxitClient(): AxiosInstance {
  const baseURL = process.env.FOXIT_BASE_URL ?? 'https://api.foxit.com/esign/v1';
  const apiKey = process.env.FOXIT_API_KEY;

  if (!apiKey) {
    throw new Error('FOXIT_API_KEY not configured');
  }

  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

export interface FoxitEnvelope {
  envelopeId: string;
  status: string;
  signingUrl?: string;
  createdAt?: string;
}

export interface FoxitEnvelopeStatus {
  envelopeId: string;
  status: 'pending' | 'sent' | 'delivered' | 'completed' | 'declined' | 'voided' | 'expired';
  completedAt?: string;
  signers: Array<{
    email: string;
    name: string;
    status: string;
    signedAt?: string;
  }>;
}

export async function createEnvelope(
  recipientEmail: string,
  recipientName: string,
  documentBuffer: Buffer,
  documentName: string
): Promise<FoxitEnvelope> {
  const client = getFoxitClient();

  try {
    // Upload document first
    const formData = new FormData();
    const blob = new Blob([documentBuffer], { type: 'application/pdf' });
    formData.append('file', blob, documentName);

    const uploadResponse = await axios.post(
      `${process.env.FOXIT_BASE_URL ?? 'https://api.foxit.com/esign/v1'}/documents`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.FOXIT_API_KEY}`,
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    const documentId: string = uploadResponse.data.documentId as string;

    // Create envelope
    const envelopeResponse = await client.post<FoxitEnvelope>('/envelopes', {
      subject: `Signature Required: ${documentName}`,
      message: 'Please review and sign this document from Frontline Healthcare Staffing.',
      documents: [{ documentId }],
      signers: [
        {
          email: recipientEmail,
          name: recipientName,
          routingOrder: 1,
          role: 'signer',
        },
      ],
      status: 'sent',
    });

    return envelopeResponse.data;
  } catch (err) {
    console.error('Foxit createEnvelope error:', err);
    throw new Error('Failed to create Foxit eSign envelope');
  }
}

export async function getEnvelopeStatus(envelopeId: string): Promise<FoxitEnvelopeStatus> {
  const client = getFoxitClient();

  try {
    const response = await client.get<FoxitEnvelopeStatus>(`/envelopes/${envelopeId}`);
    return response.data;
  } catch (err) {
    console.error('Foxit getEnvelopeStatus error:', err);
    throw new Error(`Failed to get envelope status for ${envelopeId}`);
  }
}

export async function voidEnvelope(
  envelopeId: string,
  reason = 'Voided by Frontline Healthcare Staffing'
): Promise<void> {
  const client = getFoxitClient();

  try {
    await client.put(`/envelopes/${envelopeId}/void`, { voidReason: reason });
  } catch (err) {
    console.error('Foxit voidEnvelope error:', err);
    throw new Error(`Failed to void envelope ${envelopeId}`);
  }
}

export async function downloadSignedDocument(envelopeId: string): Promise<Buffer> {
  const client = getFoxitClient();

  try {
    const response = await client.get<ArrayBuffer>(`/envelopes/${envelopeId}/documents/combined`, {
      responseType: 'arraybuffer',
    });

    return Buffer.from(response.data);
  } catch (err) {
    console.error('Foxit downloadSignedDocument error:', err);
    throw new Error(`Failed to download signed document for envelope ${envelopeId}`);
  }
}
