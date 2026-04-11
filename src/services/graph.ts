import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';

interface GraphEmail {
  id: string;
  subject: string;
  from: {
    emailAddress: {
      address: string;
      name: string;
    };
  };
  receivedDateTime: string;
  bodyPreview: string;
  body: {
    content: string;
    contentType: string;
  };
  isRead: boolean;
}

interface SharePointFile {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  lastModifiedDateTime: string;
  createdDateTime: string;
}

function getCredential(): ClientSecretCredential {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph credentials not configured');
  }

  return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

export function getGraphClient(): Client {
  const credential = getCredential();
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });

  return Client.initWithMiddleware({ authProvider });
}

export async function getEmails(userId?: string, top = 50): Promise<GraphEmail[]> {
  try {
    const client = getGraphClient();
    const userPath = userId ? `/users/${userId}` : '/me';

    const result = await client
      .api(`${userPath}/messages`)
      .select('id,subject,from,receivedDateTime,bodyPreview,body,isRead')
      .top(top)
      .orderby('receivedDateTime desc')
      .get();

    return (result.value as GraphEmail[]) ?? [];
  } catch (err) {
    console.error('Graph getEmails error:', err);
    throw new Error('Failed to fetch emails from Microsoft Graph');
  }
}

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    const client = getGraphClient();

    await client.api('/me/sendMail').post({
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: body,
        },
        toRecipients: [
          {
            emailAddress: { address: to },
          },
        ],
      },
      saveToSentItems: true,
    });
  } catch (err) {
    console.error('Graph sendEmail error:', err);
    throw new Error('Failed to send email via Microsoft Graph');
  }
}

export async function sendTeamsMessage(channelId: string, message: string): Promise<void> {
  try {
    const client = getGraphClient();

    // channelId format: "teamId/channels/channelId"
    const parts = channelId.split('/channels/');
    if (parts.length !== 2) {
      throw new Error('Invalid channelId format. Expected: teamId/channels/channelId');
    }

    const [teamId, chId] = parts;

    await client.api(`/teams/${teamId}/channels/${chId}/messages`).post({
      body: {
        content: message,
        contentType: 'html',
      },
    });
  } catch (err) {
    console.error('Graph sendTeamsMessage error:', err);
    throw new Error('Failed to send Teams message');
  }
}

export async function listSharePointFiles(
  siteId: string,
  driveId?: string
): Promise<SharePointFile[]> {
  try {
    const client = getGraphClient();
    const path = driveId
      ? `/sites/${siteId}/drives/${driveId}/root/children`
      : `/sites/${siteId}/drive/root/children`;

    const result = await client
      .api(path)
      .select('id,name,size,webUrl,lastModifiedDateTime,createdDateTime')
      .get();

    return (result.value as SharePointFile[]) ?? [];
  } catch (err) {
    console.error('Graph listSharePointFiles error:', err);
    throw new Error('Failed to list SharePoint files');
  }
}

export async function uploadToSharePoint(
  siteId: string,
  fileName: string,
  fileBuffer: Buffer
): Promise<SharePointFile> {
  try {
    const client = getGraphClient();
    const encodedName = encodeURIComponent(fileName);

    const result = await client
      .api(`/sites/${siteId}/drive/root:/${encodedName}:/content`)
      .put(fileBuffer);

    return result as SharePointFile;
  } catch (err) {
    console.error('Graph uploadToSharePoint error:', err);
    throw new Error('Failed to upload file to SharePoint');
  }
}
