import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '../middleware/auth';
import { pool } from '../db/client';

const router = Router();

// â”€â”€â”€ GET / â€” inbox (received messages) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT m.*,
        CASE WHEN m.parent_message_id IS NULL THEN 0
             ELSE (SELECT COUNT(*) FROM comp_messages WHERE parent_message_id = m.id)
        END as reply_count
       FROM comp_messages m
       WHERE m.recipient_clerk_id = $1 AND m.archived = false
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error('GET /compliance/messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ GET /sent â€” sent messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/sent', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT * FROM comp_messages
       WHERE sender_clerk_id = $1 AND parent_message_id IS NULL
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error('GET /compliance/messages/sent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ GET /unread-count â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/unread-count', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await pool.query(
      `SELECT COUNT(*) as count FROM comp_messages
       WHERE recipient_clerk_id = $1 AND read_at IS NULL AND archived = false`,
      [userId]
    );

    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.error('GET /compliance/messages/unread-count error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ POST / â€” send a message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const {
      recipient_clerk_ids,
      subject,
      body,
      message_type,
      related_competency_record_id,
    } = req.body as {
      recipient_clerk_ids: string[];
      subject?: string;
      body: string;
      message_type?: string;
      related_competency_record_id?: string;
    };

    if (!Array.isArray(recipient_clerk_ids) || recipient_clerk_ids.length === 0) {
      return res.status(400).json({ error: 'recipient_clerk_ids must be a non-empty array' });
    }
    if (!body || body.trim().length === 0) {
      return res.status(400).json({ error: 'body is required' });
    }

    const message_ids: string[] = [];

    for (const recipientId of recipient_clerk_ids) {
      const insertResult = await pool.query(
        `INSERT INTO comp_messages
          (sender_clerk_id, recipient_clerk_id, subject, body, message_type, related_competency_record_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          userId,
          recipientId,
          subject ?? null,
          body,
          message_type ?? 'general',
          related_competency_record_id ?? null,
        ]
      );
      message_ids.push(insertResult.rows[0].id);
    }

    res.status(201).json({ sent: message_ids.length, message_ids });
  } catch (err) {
    console.error('POST /compliance/messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ GET /:id â€” get a message with its replies â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NOTE: This route must come AFTER named sub-routes (/sent, /unread-count)
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    const messageResult = await pool.query(
      `SELECT * FROM comp_messages
       WHERE id = $1 AND (recipient_clerk_id = $2 OR sender_clerk_id = $2)`,
      [id, userId]
    );

    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const repliesResult = await pool.query(
      `SELECT * FROM comp_messages
       WHERE parent_message_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    res.json({ message: messageResult.rows[0], replies: repliesResult.rows });
  } catch (err) {
    console.error('GET /compliance/messages/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ POST /:id/reply â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/reply', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const { body } = req.body as { body: string };

    if (!body || body.trim().length === 0) {
      return res.status(400).json({ error: 'body is required' });
    }

    // Fetch original message to determine recipient of the reply
    const originalResult = await pool.query(
      `SELECT * FROM comp_messages
       WHERE id = $1 AND (recipient_clerk_id = $2 OR sender_clerk_id = $2)`,
      [id, userId]
    );

    if (originalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Original message not found' });
    }

    const original = originalResult.rows[0];
    // Reply recipient is the other party
    const replyRecipient =
      original.sender_clerk_id === userId
        ? original.recipient_clerk_id
        : original.sender_clerk_id;

    const replyResult = await pool.query(
      `INSERT INTO comp_messages
        (sender_clerk_id, recipient_clerk_id, subject, body, message_type, parent_message_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        replyRecipient,
        original.subject ? `Re: ${original.subject}` : null,
        body,
        original.message_type ?? 'general',
        id,
      ]
    );

    res.status(201).json({ reply: replyResult.rows[0] });
  } catch (err) {
    console.error('POST /compliance/messages/:id/reply error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ POST /:id/read â€” mark as read â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    await pool.query(
      `UPDATE comp_messages
       SET read_at = NOW()
       WHERE id = $1 AND recipient_clerk_id = $2 AND read_at IS NULL`,
      [id, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('POST /compliance/messages/:id/read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€â”€ DELETE /:id â€” archive (soft delete) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE comp_messages
       SET archived = true
       WHERE id = $1 AND (recipient_clerk_id = $2 OR sender_clerk_id = $2)
       RETURNING id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /compliance/messages/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
