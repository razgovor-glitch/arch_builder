import type { DesignerEvent, DesignerRequest } from './prompt';

export interface DesignerStatus {
  available: boolean;
  model: string;
  source: string | null;
}

/** Asks the dev server whether Claude credentials are configured. */
export async function fetchDesignerStatus(): Promise<DesignerStatus | null> {
  try {
    const res = await fetch('/api/designer/status');
    if (!res.ok) return null;
    return (await res.json()) as DesignerStatus;
  } catch {
    return null;
  }
}

/** Streams designer events (server-sent events) for one request. */
export async function streamDesigner(
  req: DesignerRequest,
  onEvent: (e: DesignerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/designer/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Designer endpoint returned ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      if (data) onEvent(JSON.parse(data) as DesignerEvent);
    }
  }
}

export async function fileToImage(file: File): Promise<NonNullable<DesignerRequest['image']>> {
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
  type Media = (typeof allowed)[number];
  if (!(allowed as readonly string[]).includes(file.type)) throw new Error('Use a PNG, JPEG, GIF or WebP image.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { mediaType: file.type as Media, data };
}
