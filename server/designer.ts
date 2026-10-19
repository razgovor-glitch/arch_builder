import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { normalizeDraft } from '../src/ai/normalize';
import {
  DRAFT_SCHEMA,
  changeBuildMessage,
  newBuildMessage,
  repairMessage,
  systemPrompt,
  type DesignerEvent,
  type DesignerRequest,
} from '../src/ai/prompt';
import { compile } from '../src/engine/compile';
import type { DesignDraft } from '../src/model/types';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type Message = Anthropic.Beta.Messages.BetaMessage;
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Read lazily: vite.config.ts loads .env into process.env after this module is imported.
const model = () => process.env.ARCH_BUILDER_MODEL || 'claude-opus-5-5';
const effort = () => (process.env.ARCH_BUILDER_EFFORT as Effort | undefined) ?? 'high';
/** How many times Claude may reinforce a build after the engine finds problems. */
const MAX_REPAIRS = 2;

export function designerStatus(): { available: boolean; model: string; source: string | null } {
  const fromEnv = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const fromProfile = fs.existsSync(path.join(os.homedir(), '.config', 'anthropic'));
  return { available: fromEnv || fromProfile, model: model(), source: fromEnv ? 'environment' : fromProfile ? 'profile' : null };
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

class DesignerError extends Error {}

async function streamDesign(
  messages: MessageParam[],
  emit: (e: DesignerEvent) => void,
  signal: AbortSignal,
): Promise<{ message: Message; draft: DesignDraft }> {
  const stream = anthropic().beta.messages.stream(
    {
      model: model(),
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: effort(), format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      system: systemPrompt(),
      messages,
    },
    { signal },
  );

  let lastThought = '';
  let started = false;
  let components = -1;
  let joints = -1;
  stream.on('thinking', (_delta, snapshot) => {
    // Surface the latest line of Claude's summarized reasoning as the current phase.
    const line = snapshot.trim().split('\n').filter(Boolean).at(-1)?.replace(/^[#*\s-]+/, '').slice(0, 120);
    if (line && line !== lastThought && !started) {
      lastThought = line;
      emit({ type: 'phase', text: line });
    }
  });
  stream.on('text', (_delta, snapshot) => {
    if (!started) {
      started = true;
      emit({ type: 'phase', text: 'Placing components…' });
    }
    const c = (snapshot.match(/"kind"\s*:/g) ?? []).length;
    const j = (snapshot.match(/"protocol"\s*:/g) ?? []).length;
    if (c !== components || j !== joints) {
      components = c;
      joints = j;
      emit({ type: 'progress', components: c, joints: j });
    }
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new DesignerError('Claude declined this request. Try rephrasing it.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new DesignerError('The design ran out of room before it finished. Try a narrower request.');
  }
  const text = message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return { message, draft: JSON.parse(text) as DesignDraft };
  } catch {
    throw new DesignerError('Claude returned a design the engine could not read.');
  }
}

export async function runDesigner(req: DesignerRequest, emit: (e: DesignerEvent) => void, signal: AbortSignal): Promise<void> {
  const changing = req.mode === 'change' && req.current;
  const content: ContentBlockParam[] = [];
  if (req.image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: req.image.mediaType, data: req.image.data } });
  }
  content.push({
    type: 'text',
    text: changing ? changeBuildMessage(req.prompt, req.current!, Boolean(req.image)) : newBuildMessage(req.prompt, Boolean(req.image)),
  });
  const messages: MessageParam[] = [{ role: 'user', content }];

  emit({ type: 'phase', text: changing ? 'Reading the current build…' : 'Planning the shape…' });
  for (let attempt = 0; ; attempt++) {
    const { message, draft } = await streamDesign(messages, emit, signal);
    const { design, notes } = normalizeDraft(draft, { prompt: req.prompt, previous: changing ? req.current : null });
    const result = compile(design);
    const problems = result.issues.filter((i) => i.severity !== 'info');
    emit({
      type: 'phase',
      text: `Checked ${result.stats.joints} joints — ${result.stats.weakJoints} weak, ${result.stats.errors} errors, ${result.stats.warnings} warnings`,
    });
    if (!problems.length || attempt >= MAX_REPAIRS) {
      emit({ type: 'result', design, notes, repairs: attempt });
      return;
    }
    emit({ type: 'phase', text: `Reinforcing ${problems.length} problem${problems.length === 1 ? '' : 's'}…` });
    // Append-only history: the assistant turn goes back exactly as received.
    messages.push({ role: 'assistant', content: message.content as unknown as ContentBlockParam[] });
    messages.push({ role: 'user', content: repairMessage(problems.slice(0, 40)) });
  }
}

function describeError(error: unknown): string {
  if (error instanceof DesignerError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Claude credentials are missing or invalid. Set ANTHROPIC_API_KEY in .env and restart the dev server.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) return `This API key cannot use ${model()}.`;
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited by the Claude API. Wait a moment and try again.';
  if (error instanceof Anthropic.BadRequestError) return `The Claude API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API.';
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status ?? ''}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function readBody(req: IncomingMessage, limit = 25 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new DesignerError('Request too large (images are limited to about 18 MB).');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Connect-style middleware mounted at /api/designer by the Vite plugin. */
export async function designerMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url.startsWith('/status')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(designerStatus()));
    return;
  }
  if (req.method !== 'POST' || !(url === '/' || url.startsWith('/generate'))) {
    next();
    return;
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const emit = (e: DesignerEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  try {
    const body = JSON.parse(await readBody(req)) as DesignerRequest;
    if (!body.prompt?.trim() && !body.image) throw new DesignerError('Describe what to build.');
    if (!designerStatus().available) {
      throw new DesignerError('Claude is not configured. Set ANTHROPIC_API_KEY in .env (or run `ant auth login`) and restart the dev server.');
    }
    await runDesigner(body, emit, controller.signal);
  } catch (error) {
    if (!(error instanceof Anthropic.APIUserAbortError) && !controller.signal.aborted) {
      emit({ type: 'error', message: describeError(error) });
    }
  } finally {
    res.end();
  }
}
