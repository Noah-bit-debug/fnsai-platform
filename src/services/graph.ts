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

// ─── OneDrive functions ────────────────────────────────────────────────────

export interface OneDriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl: string;
  lastModifiedDateTime: string;
  createdDateTime: string;
  folder?: { childCount: number };
  file?: { mimeType: string };
}

export async function listOneDriveFolders(folderPath = '/'): Promise<OneDriveItem[]> {
  try {
    const client = getGraphClient();
    const driveUserId = process.env.ONEDRIVE_USER_ID || process.env.MICROSOFT_USER_ID;
    const base = driveUserId ? `/users/${driveUserId}` : '/me';
    const apiPath = !folderPath || folderPath === '/'
      ? `${base}/drive/root/children`
      : `${base}/drive/root:${encodeURIComponent(folderPath)}:/children`;
    const result = await client.api(apiPath)
      .select('id,name,size,webUrl,lastModifiedDateTime,createdDateTime,folder,file')
      .top(100).get();
    return ((result.value as OneDriveItem[]) ?? []).filter((i: OneDriveItem) => i.folder);
  } catch (err) {
    console.error('listOneDriveFolders error:', err);
    throw new Error('Failed to list OneDrive folders');
  }
}

export async function listOneDriveFiles(folderPath = '/'): Promise<OneDriveItem[]> {
  try {
    const client = getGraphClient();
    const driveUserId = process.env.ONEDRIVE_USER_ID || process.env.MICROSOFT_USER_ID;
    const base = driveUserId ? `/users/${driveUserId}` : '/me';
    const apiPath = !folderPath || folderPath === '/'
      ? `${base}/drive/root/children`
      : `${base}/drive/root:${encodeURIComponent(folderPath)}:/children`;
    const result = await client.api(apiPath)
      .select('id,name,size,webUrl,lastModifiedDateTime,createdDateTime,folder,file')
      .top(100).get();
    return (result.value as OneDriveItem[]) ?? [];
  } catch (err) {
    console.error('listOneDriveFiles error:', err);
    throw new Error('Failed to list OneDrive files');
  }
}

export async function searchOneDriveFiles(query: string): Promise<OneDriveItem[]> {
  try {
    const client = getGraphClient();
    const driveUserId = process.env.ONEDRIVE_USER_ID || process.env.MICROSOFT_USER_ID;
    const base = driveUserId ? `/users/${driveUserId}` : '/me';
    const result = await client.api(`${base}/drive/root/search(q='${encodeURIComponent(query)}')`)
      .select('id,name,size,webUrl,lastModifiedDateTime,createdDateTime,folder,file')
      .top(50).get();
    return (result.value as OneDriveItem[]) ?? [];
  } catch (err) {
    console.error('searchOneDriveFiles error:', err);
    throw new Error('Failed to search OneDrive files');
  }
}

export async function uploadToOneDriveFolder(folderPath: string, fileName: string, fileBuffer: Buffer): Promise<OneDriveItem> {
  try {
    const client = getGraphClient();
    const driveUserId = process.env.ONEDRIVE_USER_ID || process.env.MICROSOFT_USER_ID;
    const base = driveUserId ? `/users/${driveUserId}` : '/me';
    const folderClean = folderPath.replace(/^\//, '');
    const encodedName = encodeURIComponent(fileName);
    const uploadPath = folderClean && folderClean !== 'Unassigned'
      ? `${base}/drive/root:/${encodeURIComponent(folderClean)}/${encodedName}:/content`
      : `${base}/drive/root:/${encodedName}:/content`;
    const result = await client.api(uploadPath).put(fileBuffer);
    return result as OneDriveItem;
  } catch (err) {
    console.error('uploadToOneDriveFolder error:', err);
    throw new Error('Failed to upload file to OneDrive');
  }
}

export async function createOneDriveFolder(folderName: string, parentPath = '/'): Promise<OneDriveItem> {
  try {
    const client = getGraphClient();
    const driveUserId = process.env.ONEDRIVE_USER_ID || process.env.MICROSOFT_USER_ID;
    const base = driveUserId ? `/users/${driveUserId}` : '/me';
    const apiPath = !parentPath || parentPath === '/'
      ? `${base}/drive/root/children`
      : `${base}/drive/root:${encodeURIComponent(parentPath)}:/children`;
    const result = await client.api(apiPath).post({
      name: folderName, folder: {}, '@microsoft.graph.conflictBehavior': 'rename',
    });
    return result as OneDriveItem;
  } catch (err) {
    console.error('createOneDriveFolder error:', err);
    throw new Error('Failed to create OneDrive folder');
  }
}

// ─── Enhanced email search ─────────────────────────────────────────────────

export interface EmailSearchOptions {
  sender?: string;
  keyword?: string;
  subject?: string;
  dateFrom?: string;
  dateTo?: string;
  hasAttachments?: boolean;
  top?: number;
  userId?: string;
}

export async function searchEmails(options: EmailSearchOptions = {}): Promise<GraphEmail[]> {
  try {
    const client = getGraphClient();
    const { sender, keyword, subject, dateFrom, dateTo, hasAttachments, top = 20, userId } = options;
    const userPath = userId ? `/users/${userId}` : '/me';
    const filters: string[] = [];
    if (sender) filters.push(`from/emailAddress/address eq '${sender}'`);
    if (hasAttachments === true) filters.push('hasAttachments eq true');
    if (dateFrom) filters.push(`receivedDateTime ge ${new Date(dateFrom).toISOString()}`);
    if (dateTo) filters.push(`receivedDateTime le ${new Date(dateTo).toISOString()}`);
    const searchTerms: string[] = [];
    if (keyword) searchTerms.push(`"${keyword}"`);
    if (subject) searchTerms.push(`subject:"${subject}"`);
    let apiReq = client.api(`${userPath}/messages`)
      .select('id,subject,from,receivedDateTime,bodyPreview,hasAttachments,isRead')
      .top(top).orderby('receivedDateTime desc');
    if (filters.length > 0) apiReq = apiReq.filter(filters.join(' and '));
    if (searchTerms.length > 0) apiReq = apiReq.search(searchTerms.join(' '));
    const result = await apiReq.get();
    return (result.value as GraphEmail[]) ?? [];
  } catch (err) {
    console.error('searchEmails error:', err);
    throw new Error('Failed to search emails');
  }
}

export async function getEmailWithAttachments(emailId: string, userId?: string): Promise<{ email: GraphEmail; attachments: any[] }> {
  try {
    const client = getGraphClient();
    const userPath = userId ? `/users/${userId}` : '/me';
    const [email, attachmentsResult] = await Promise.all([
      client.api(`${userPath}/messages/${emailId}`).select('id,subject,from,receivedDateTime,body,hasAttachments,isRead').get(),
      client.api(`${userPath}/messages/${emailId}/attachments`).select('id,name,contentType,size').get(),
    ]);
    return { email: email as GraphEmail, attachments: attachmentsResult.value ?? [] };
  } catch (err) {
    console.error('getEmailWithAttachments error:', err);
    throw new Error('Failed to fetch email with attachments');
  }
}
