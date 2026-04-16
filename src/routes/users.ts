import { Router, Request, Response } from 'express';
import { requireAuth, clerkClient } from '@clerk/express';

const router = Router();

// ─── GET /api/v1/users — list all org users ───────────────────
router.get('/', requireAuth(), async (req: Request, res: Response) => {
  try {
    const response = await clerkClient.users.getUserList({ limit: 100, orderBy: '-created_at' });
    const users = response.data.map((u) => ({
      id: u.id,
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown',
      email: u.emailAddresses[0]?.emailAddress ?? '',
      role: (u.publicMetadata?.role as string) ?? 'viewer',
      lastSignInAt: u.lastSignInAt ?? null,
      createdAt: u.createdAt,
      imageUrl: u.imageUrl ?? '',
    }));
    res.json({ users, total: users.length });
  } catch (err: any) {
    console.error('GET /users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── PATCH /api/v1/users/:userId — update role ───────────────
router.patch('/:userId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body as { role: string };

    const VALID_ROLES = ['ceo', 'admin', 'manager', 'hr', 'recruiter', 'coordinator', 'viewer'];
    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
    }

    await clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: { role },
    });

    res.json({ success: true, userId, role });
  } catch (err: any) {
    console.error('PATCH /users/:userId error:', err);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

export default router;
