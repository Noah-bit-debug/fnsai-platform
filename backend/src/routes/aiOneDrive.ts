import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAuth } from '@clerk/express';
import { pool } from '../db/client';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import { listOneDriveFolders, listOneDriveFiles, searchOneDriveFiles, uploadToOneDriveFolder } from '../services/graph';
import { MODEL_FOR } from '../services/aiModels';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const KNOWN_FOLDERS = [
  'Joint Commission', 'Candidate Credentials', 'Onboarding Documents',
  'Compliance Files', 'Credentialing', 'BLS & Certifications',
  'Policies & Procedures', 'HR Documents', 'Facility Contracts',
  'Training Materials', 'Incident Reports', 'Unassigned',
];

// GET /api/v1/ai-onedrive/folders
router.get('/folders', requireAuth, async (req: Request, res: Response) => {
  const path = (req.query.path as string) || '/';
  try {
    const folders = await listOneDriveFolders(path);
    res.json({ folders, path });
  } catch (err: any) {
    res.json({
      folders: KNOWN_FOLDERS.map(name => ({ name, path: `/${name}`, item_count: null, offline: true })),
      path, offline: true, error: err.message,
    });
  }
});

// GET /api/v1/ai-onedrive/browse
router.get('/browse', requireAuth, async (req: Request, res: Response) => {
  const path = (req.query.path as string) || '/';
  try {
    const files = await listOneDriveFiles(path);
    res.json({ files, path });
  } catch (err: any) {
    res.json({ files: [], path, error: err.message ?? 'OneDrive unavailable' });
  }
});

// GET /api/v1/ai-onedrive/search
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q || q.length < 2) { res.status(400).json({ error: 'q is required' }); return; }
  try {
    const files = await searchOneDriveFiles(q);
    res.json({ files, query: q });
  } catch (err: any) {
    res.json({ files: [], query: q, error: err.message ?? 'OneDrive search unavailable' });
  }
});

// POST /api/v1/ai-onedrive/upload
router.post('/upload', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'file is required' }); return; }

  const { destination_folder, context_hint, candidate_context } = req.body as {
    destination_folder?: string; context_hint?: string; candidate_context?: string;
  };

  let targetFolder = destination_folder;
  let routingConfidence = 'high';
  let routingReason = 'Manually specified by user';

  if (!targetFolder) {
    try {
      const routePrompt = `Route this file for Frontline Healthcare Staffing OneDrive.
Filename: "${file.originalname}"
File type: ${file.mimetype}
${context_hint ? `Context: ${context_hint}` : ''}
${candidate_context ? `Candidate: ${candidate_context}` : ''}
Available folders: ${KNOWN_FOLDERS.join(', ')}
Return ONLY valid JSON: {"folder": "folder name", "confidence": "high|medium|low", "reason": "brief reason"}`;

      const routeResp = await anthropic.messages.create({
        model: MODEL_FOR.searchSynthesis,
        max_tokens: 256,
        messages: [{ role: 'user', content: routePrompt }],
      });
      const block = routeResp.content[0];
      if (block.type === 'text') {
        const match = block.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          targetFolder = parsed.folder ?? 'Unassigned';
          routingConfidence = parsed.confidence ?? 'medium';
          routingReason = parsed.reason ?? 'AI auto-routed';
        }
      }
    } catch {
      targetFolder = 'Unassigned';
      routingConfidence = 'low';
      routingReason = 'Auto-routing failed';
    }
  }

  let oneDriveItemId: string | null = null;
  let oneDriveUrl: string | null = null;
  let uploadStatus = 'uploaded';

  try {
    const result = await uploadToOneDriveFolder(targetFolder!, file.originalname, file.buffer);
    oneDriveItemId = (result as any).id ?? null;
    oneDriveUrl = (result as any).webUrl ?? null;
  } catch (err: any) {
    console.error('OneDrive upload error:', err);
    uploadStatus = 'failed';
  }

  const logResult = await pool.query(
    `INSERT INTO ai_brain_uploads
     (user_clerk_id, original_filename, destination_path, onedrive_item_id, onedrive_web_url, file_size, mime_type, routing_confidence, routing_reason, candidate_context, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [auth?.userId ?? 'unknown', file.originalname, targetFolder, oneDriveItemId, oneDriveUrl, file.size, file.mimetype, routingConfidence, routingReason, candidate_context ?? null, uploadStatus]
  ).catch(() => ({ rows: [{}] }));

  await pool.query(
    `INSERT INTO ai_brain_audit (user_clerk_id, action_type, source, details, ip_address) VALUES ($1,'file_upload','onedrive',$2,$3)`,
    [auth?.userId ?? 'unknown', JSON.stringify({ filename: file.originalname, folder: targetFolder, confidence: routingConfidence, status: uploadStatus }), req.ip ?? 'unknown']
  ).catch(() => {});

  res.json({
    success: uploadStatus === 'uploaded',
    filename: file.originalname,
    destination_folder: targetFolder,
    routing_confidence: routingConfidence,
    routing_reason: routingReason,
    onedrive_url: oneDriveUrl,
    status: uploadStatus,
    upload_id: (logResult as any).rows[0]?.id,
  });
});

// GET /api/v1/ai-onedrive/uploads
router.get('/uploads', requireAuth, async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  try {
    const result = await pool.query(`SELECT * FROM ai_brain_uploads ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json({ uploads: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

export default router;
