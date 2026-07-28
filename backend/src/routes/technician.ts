import express, { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { assistantSchema } from '../lib/validation.js';
import { assistantEnabled, generateReply } from '../lib/assistant.js';
import { transcribeAudio, transcriptionEnabled } from '../lib/transcription.js';
import { badRequest } from '../lib/errors.js';

/**
 * The technician app's server surface.
 *
 * Deliberately small: capture and object detection happen entirely in the
 * browser, so recordings never leave the device unless the technician chooses
 * to download them. What the server does is the two things a browser cannot do
 * alone — talk to a language model, and transcribe audio on the phones whose
 * browsers ship no usable speech recognition.
 */
export const technicianRouter = Router();

technicianRouter.use(requireAuth);

/**
 * Both endpoints below are paid, per-call upstream requests, so they get a
 * tighter budget than the rest of the API. A technician holding a real
 * conversation lands well under this; a runaway client loop does not.
 */
const assistLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "You're going faster than I can keep up. Give me a few seconds.",
      code: 'rate_limited',
    });
  },
});

/**
 * GET /api/technician/capabilities
 * What this deployment can actually do. The client uses it to decide whether to
 * offer server transcription and whether to label replies as AI-generated,
 * rather than discovering a 501 mid-conversation.
 */
technicianRouter.get('/capabilities', (_req: Request, res: Response) => {
  res.json({
    assistant: assistantEnabled(),
    transcription: transcriptionEnabled(),
    maxAudioUploadBytes: config.technician.maxAudioUploadBytes,
  });
});

/**
 * POST /api/technician/assist
 * One turn of the voice conversation. The client owns the transcript and
 * replays it here, so nothing about a job is persisted server-side.
 */
technicianRouter.post(
  '/assist',
  assistLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { message, history, context } = assistantSchema.parse(req.body);
      const { reply, model } = await generateReply(message, history, context);
      res.json({ reply, model });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/technician/transcribe
 * Body is the raw audio clip; `Content-Type` carries the container the browser
 * recorded (`audio/webm`, `audio/mp4`, …). Raw rather than multipart because
 * there is exactly one field and it saves a dependency.
 */
technicianRouter.post(
  '/transcribe',
  assistLimiter,
  express.raw({
    type: ['audio/*', 'video/webm'],
    limit: config.technician.maxAudioUploadBytes,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audio = req.body as Buffer;
      if (!Buffer.isBuffer(audio) || audio.length === 0) {
        throw badRequest('Send the recording as the raw request body with an audio Content-Type.', 'no_audio');
      }
      const mimeType = req.get('content-type') ?? 'audio/webm';
      const text = await transcribeAudio(audio, mimeType);
      res.json({ text });
    } catch (err) {
      next(err);
    }
  },
);
