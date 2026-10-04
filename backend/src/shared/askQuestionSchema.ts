import { z } from 'zod';

/**
 * A chat message. "?", "ok", and "hi" are real messages, so the only floor is
 * one non-space character. Every Ask route parses the question with this.
 */
export const askQuestionText = z.string().trim().min(1).max(1000);
