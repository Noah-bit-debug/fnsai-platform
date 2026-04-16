import { Router, Request, Response } from 'express';
import { requireAuth, getAuth } from '@clerk/express';
import { pool } from '../db/client';

const router = Router();

// ---------------------------------------------------------------------------
// GET / — requireAuth(). List MY certificates.
// ---------------------------------------------------------------------------

router.get('/', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);

    const result = await pool.query(
      `SELECT c.*, cr.score, cr.completed_date, e.passing_score
       FROM comp_certificates c
       LEFT JOIN comp_competency_records cr ON cr.id = c.competency_record_id
       LEFT JOIN comp_exams e ON e.id = c.exam_id
       WHERE c.user_clerk_id = $1
       ORDER BY c.issued_at DESC`,
      [userId],
    );

    res.json({ certificates: result.rows });
  } catch (err: any) {
    console.error('[compliance-certificates] GET / error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /all — requireAuth(). Admin: all certificates.
// ---------------------------------------------------------------------------

router.get('/all', requireAuth(), async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.*, cr.score, cr.completed_date
       FROM comp_certificates c
       LEFT JOIN comp_competency_records cr ON cr.id = c.competency_record_id
       ORDER BY c.issued_at DESC
       LIMIT 200`,
    );

    res.json({ certificates: result.rows, total: result.rowCount ?? result.rows.length });
  } catch (err: any) {
    console.error('[compliance-certificates] GET /all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /verify/:number — NO auth. Public certificate verification.
// ---------------------------------------------------------------------------

router.get('/verify/:number', async (req: Request, res: Response) => {
  try {
    const { number } = req.params;

    const result = await pool.query(
      `SELECT c.*, cr.score, cr.user_clerk_id
       FROM comp_certificates c
       LEFT JOIN comp_competency_records cr ON cr.id = c.competency_record_id
       WHERE c.certificate_number = $1`,
      [number],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, message: 'Certificate not found' });
    }

    res.json({ valid: true, certificate: { ...result.rows[0] } });
  } catch (err: any) {
    console.error('[compliance-certificates] GET /verify/:number error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:id — requireAuth(). Single certificate by ID.
// ---------------------------------------------------------------------------

router.get('/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*, cr.score, cr.user_clerk_id
       FROM comp_certificates c
       LEFT JOIN comp_competency_records cr ON cr.id = c.competency_record_id
       WHERE c.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    res.json({ certificate: { ...result.rows[0] } });
  } catch (err: any) {
    console.error('[compliance-certificates] GET /:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/print — requireAuth(). Print-ready HTML certificate page.
// ---------------------------------------------------------------------------

router.get('/:id/print', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*, cr.score, cr.user_clerk_id, cr.completed_date, e.passing_score
       FROM comp_certificates c
       LEFT JOIN comp_competency_records cr ON cr.id = c.competency_record_id
       LEFT JOIN comp_exams e ON e.id = c.exam_id
       WHERE c.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const cert = result.rows[0];

    // Format dates
    const formatDate = (dt: string | null): string => {
      if (!dt) return 'N/A';
      return new Date(dt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    };

    const issuedDate    = formatDate(cert.issued_at);
    const expiresDate   = cert.expires_at ? formatDate(cert.expires_at) : 'No Expiration';
    const recipientId   = cert.user_clerk_id ?? cert.competency_record_id ?? 'Unknown';
    const recipientDisplay = `User ${String(recipientId).slice(0, 8)}`;
    const scoreLine     = cert.score != null
      ? `<p class="score">with a score of <strong>${cert.score}%</strong></p>`
      : '';

    const htmlString = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Certificate — ${cert.title ?? 'Certificate of Completion'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #f0f0f0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      font-family: Georgia, 'Times New Roman', serif;
    }

    .certificate {
      background: #fff;
      max-width: 800px;
      min-height: 560px;
      width: 100%;
      padding: 10px;
      border: 6px solid #1a3a5c;
    }

    .inner {
      border: 2px solid #b8972e;
      padding: 40px 50px;
      min-height: 520px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: center;
    }

    .header-title {
      font-size: 2rem;
      font-weight: bold;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #1a3a5c;
      margin-bottom: 8px;
    }

    .decorative-line {
      width: 60%;
      height: 2px;
      background: linear-gradient(to right, transparent, #b8972e, transparent);
      margin: 0 auto 28px;
    }

    .certify-text {
      font-style: italic;
      color: #777;
      font-size: 1rem;
      margin-bottom: 14px;
    }

    .recipient {
      font-size: 1.6rem;
      font-weight: bold;
      color: #1a1a1a;
      margin-bottom: 14px;
      font-style: italic;
    }

    .completed-text {
      color: #555;
      font-size: 0.95rem;
      margin-bottom: 16px;
    }

    .course-title {
      font-size: 1.4rem;
      font-weight: bold;
      color: #1a3a5c;
      margin-bottom: 14px;
    }

    .score {
      font-size: 1rem;
      color: #444;
      margin-bottom: 8px;
    }

    .bottom-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e0d0a0;
      font-size: 0.82rem;
      color: #555;
    }

    .bottom-row .label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #999;
      display: block;
      margin-bottom: 4px;
    }

    .bottom-row .cert-number {
      font-weight: bold;
      color: #1a3a5c;
    }

    .footer {
      margin-top: 18px;
      font-size: 0.75rem;
      color: #aaa;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    @media print {
      body { background: #fff; }
      .certificate { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="inner">
      <div>
        <p class="header-title">Certificate of Completion</p>
        <div class="decorative-line"></div>

        <p class="certify-text">This certifies that</p>
        <p class="recipient">${recipientDisplay}</p>
        <p class="completed-text">has successfully completed</p>
        <p class="course-title">${cert.title ?? 'Compliance Training'}</p>
        ${scoreLine}
      </div>

      <div>
        <div class="bottom-row">
          <div>
            <span class="label">Issued</span>
            ${issuedDate}
          </div>
          <div>
            <span class="label">Certificate No.</span>
            <span class="cert-number">${cert.certificate_number ?? id}</span>
          </div>
          <div style="text-align:right">
            <span class="label">Expires</span>
            ${expiresDate}
          </div>
        </div>
        <p class="footer">Frontline Nurse Staffing &mdash; Compliance System</p>
      </div>
    </div>
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(htmlString);
  } catch (err: any) {
    console.error('[compliance-certificates] GET /:id/print error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
