// API client for transcript endpoints
// Points to the local backend server

const API_BASE = 'http://127.0.0.1:8000';
const BASE = `${API_BASE}/api/transcripts`;

export interface TranscriptSummary {
  id: string;
  session_id: string | null;
  lang: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface TranscriptDetail extends TranscriptSummary {
  lines: string[];
}

export async function createTranscript(
  lang: string,
  sessionId?: string | null,
  title?: string | null,
): Promise<string> {
  const res = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, session_id: sessionId ?? null, title: title ?? null }),
  });
  if (!res.ok) throw new Error(`Failed to create transcript: ${res.status}`);
  const data = await res.json() as { id: string };
  return data.id;
}

export async function appendLine(transcriptId: string, line: string): Promise<void> {
  const res = await fetch(`${BASE}/${transcriptId}/append`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
  });
  if (!res.ok) throw new Error(`Failed to append line: ${res.status}`);
}

export async function endTranscript(transcriptId: string): Promise<void> {
  const res = await fetch(`${BASE}/${transcriptId}/end`, { method: 'PATCH' });
  if (!res.ok) throw new Error(`Failed to end transcript: ${res.status}`);
}

export async function listTranscripts(sessionId?: string): Promise<TranscriptSummary[]> {
  const url = sessionId ? `${BASE}/?session_id=${encodeURIComponent(sessionId)}` : `${BASE}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to list transcripts: ${res.status}`);
  return res.json() as Promise<TranscriptSummary[]>;
}

export async function getTranscript(transcriptId: string): Promise<TranscriptDetail> {
  const res = await fetch(`${BASE}/${transcriptId}`);
  if (!res.ok) throw new Error(`Failed to get transcript: ${res.status}`);
  return res.json() as Promise<TranscriptDetail>;
}

export async function deleteTranscript(transcriptId: string): Promise<void> {
  const res = await fetch(`${BASE}/${transcriptId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete transcript: ${res.status}`);
}

// Fetch sessions from the backend
export async function fetchSessions(): Promise<{ session_id: string; title: string }[]> {
  const res = await fetch(`${API_BASE}/api/sessions/`);
  if (!res.ok) return [];
  return res.json() as Promise<{ session_id: string; title: string }[]>;
}

// Check if backend is reachable
export async function checkBackendConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/`, { method: 'HEAD' });
    return res.ok || res.status === 404; // 404 is fine, it means server is up
  } catch {
    return false;
  }
}
