import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Checks which integration credentials are actually present on the backend.
// Returns a small struct so the frontend can show truthful pill states
// in the topbar AND a real "Integration Settings" page.
//
// Keep this path cheap — env reads only, never hits external APIs.
function present(v: string | undefined): boolean {
  return !!(v && v.trim().length > 0);
}

router.get('/status', requireAuth, (_req: Request, res: Response) => {
  const env = process.env;

  // Microsoft 365 (Graph API) umbrella — same credentials unlock Outlook,
  // Teams, SharePoint, and OneDrive.
  const msConfigured = present(env.MICROSOFT_TENANT_ID) &&
                        present(env.MICROSOFT_CLIENT_ID) &&
                        present(env.MICROSOFT_CLIENT_SECRET);

  const integrations = [
    {
      key: 'anthropic',
      name: 'Anthropic (AI)',
      connected: present(env.ANTHROPIC_API_KEY),
      required_env: ['ANTHROPIC_API_KEY'],
      docs_url: 'https://console.anthropic.com/',
      description: 'Powers AI Assistant, candidate scoring, job ads, and outreach drafting.',
    },
    {
      key: 'outlook',
      name: 'Outlook',
      connected: msConfigured,
      required_env: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
      docs_url: 'https://portal.azure.com/',
      description: 'Email search, send, and inbox monitoring via Microsoft Graph.',
    },
    {
      key: 'teams',
      name: 'Teams',
      connected: msConfigured,
      required_env: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
      docs_url: 'https://portal.azure.com/',
      description: 'Send reminders and notifications via Microsoft Teams.',
    },
    {
      key: 'sharepoint',
      name: 'SharePoint',
      connected: msConfigured,
      required_env: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
      docs_url: 'https://portal.azure.com/',
      description: 'Compliance document storage via SharePoint (via Graph).',
    },
    {
      key: 'onedrive',
      name: 'OneDrive',
      connected: msConfigured,
      required_env: ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
      docs_url: 'https://portal.azure.com/',
      description: 'File search and document retrieval via OneDrive (via Graph).',
    },
    {
      key: 'foxit_esign',
      name: 'Foxit eSign',
      connected: present(env.FOXIT_API_KEY),
      required_env: ['FOXIT_API_KEY', 'FOXIT_BASE_URL'],
      docs_url: 'https://www.foxit.com/esign/',
      description: 'Contract and offer letter e-signing for placements.',
    },
    {
      key: 'clerkchat_sms',
      name: 'ClerkChat SMS',
      connected: present(env.CLERKCHAT_API_KEY),
      required_env: ['CLERKCHAT_API_KEY', 'CLERKCHAT_FROM_NUMBER'],
      docs_url: 'https://clerkchat.com/',
      description: 'Outbound SMS to candidates, staff, and clients.',
    },
    {
      key: 'clerk_auth',
      name: 'Clerk Auth',
      connected: present(env.CLERK_SECRET_KEY),
      required_env: ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY'],
      docs_url: 'https://clerk.com/',
      description: 'User authentication and role-based access control.',
    },
  ];

  res.json({ integrations });
});

export default router;
