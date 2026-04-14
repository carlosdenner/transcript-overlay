import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Minus, Plus, Languages, Circle, CircleDot, WifiOff } from 'lucide-react';
import { 
  createTranscript, 
  appendLine as apiAppendLine, 
  endTranscript,
  fetchSessions,
  checkBackendConnection 
} from '../api/transcripts';

// ── Types ──────────────────────────────────────────────────────────────────────

type SpeechLang = 'fr-FR' | 'en-US' | 'pt-BR';

// ── Language configuration ─────────────────────────────────────────────────────

const LANGUAGES: Record<SpeechLang, { label: string; short: string; code: string }> = {
  'fr-FR': { label: 'French', short: 'FR', code: 'fr' },
  'en-US': { label: 'English', short: 'EN', code: 'en' },
  'pt-BR': { label: 'Portuguese', short: 'PT', code: 'pt' },
};

const LANG_OPTIONS = Object.keys(LANGUAGES) as SpeechLang[];

// ── Constants ──────────────────────────────────────────────────────────────────

const FONT_MIN = 32;
const FONT_MAX = 96;
const FONT_STEP = 8;
const FONT_DEFAULT = 56;
const HISTORY_SIZE = 4;
const STORAGE_KEY = 'profos-transcription-size';
const STORAGE_SOURCE_LANG = 'profos-transcript-source-lang';
const STORAGE_TARGET_LANG = 'profos-transcript-target-lang';

// Opacity for the 4 history lines, index 0 = oldest
const HISTORY_OPACITY = [0.15, 0.30, 0.45, 0.60] as const;

// ── MyMemory translation ─────────────────────────────────────────────────────
async function translateText(text: string, sourceLang: SpeechLang, targetLang: SpeechLang): Promise<string> {
  const sourceCode = LANGUAGES[sourceLang].code;
  const targetCode = LANGUAGES[targetLang].code;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceCode}|${targetCode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { responseData?: { translatedText?: string } };
  const translated = data.responseData?.translatedText;
  if (!translated) throw new Error('No translation returned');
  return translated;
}

// ── SpeechRecognition shim ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any;

function getSpeechRecognition(): (new () => AnySpeechRecognition) | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── Elapsed timer hook ─────────────────────────────────────────────────────────

function useElapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── Tauri window controls ──────────────────────────────────────────────────────

async function minimizeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  } catch (err) {
    console.warn('Could not minimize window:', err);
  }
}

async function closeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch (err) {
    console.warn('Could not close window:', err);
    // Fallback for dev mode in browser
    window.close();
  }
}

async function startDragging() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch (err) {
    console.warn('Could not start dragging:', err);
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LiveTranscriptionOverlay() {
  const elapsed = useElapsed();

  // Helper to validate stored language
  const isValidLang = (val: string | null): val is SpeechLang =>
    val === 'fr-FR' || val === 'en-US' || val === 'pt-BR';

  // Source language state (speech recognition language, persisted)
  const [sourceLang, setSourceLang] = useState<SpeechLang>(() => {
    const stored = localStorage.getItem(STORAGE_SOURCE_LANG);
    return isValidLang(stored) ? stored : 'fr-FR';
  });

  // Target language state (translation output language, persisted)
  const [targetLang, setTargetLang] = useState<SpeechLang>(() => {
    const stored = localStorage.getItem(STORAGE_TARGET_LANG);
    if (isValidLang(stored)) return stored;
    // Default to something different from source
    const storedSource = localStorage.getItem(STORAGE_SOURCE_LANG);
    return storedSource === 'en-US' ? 'fr-FR' : 'en-US';
  });

  const [interim, setInterim] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const n = stored ? Number(stored) : FONT_DEFAULT;
    return Number.isFinite(n) ? Math.max(FONT_MIN, Math.min(FONT_MAX, n)) : FONT_DEFAULT;
  });

  const recognitionRef = useRef<AnySpeechRecognition | null>(null);
  const sourceLangRef = useRef(sourceLang);
  const targetLangRef = useRef(targetLang);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  // ── Recording state ───────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [sessions, setSessions] = useState<{ session_id: string; title: string }[] | null>(null);
  const transcriptIdRef = useRef<string | null>(null);

  // Keep ref in sync
  useEffect(() => { transcriptIdRef.current = transcriptId; }, [transcriptId]);

  // Check backend connection on mount
  useEffect(() => {
    checkBackendConnection().then(setBackendConnected);
    // Re-check every 30 seconds
    const id = setInterval(() => {
      checkBackendConnection().then(setBackendConnected);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // Fetch sessions
  const ensureSessions = async () => {
    if (sessions !== null) return;
    const data = await fetchSessions();
    setSessions(data);
  };

  const startRecording = async () => {
    await ensureSessions();
    try {
      const id = await createTranscript(
        sourceLang,
        selectedSessionId || null,
        selectedSessionId ? undefined : 'Ad hoc',
      );
      setTranscriptId(id);
      setIsRecording(true);
    } catch {
      setErrorMsg('Could not start recording — backend may not be running.');
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    const id = transcriptIdRef.current;
    if (id) {
      setTranscriptId(null);
      await endTranscript(id).catch(() => {});
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const handleClose = useCallback(() => {
    if (transcriptIdRef.current) {
      endTranscript(transcriptIdRef.current).catch(() => {});
    }
    closeWindow();
  }, []);

  // Map from original line index to its translation
  const [translationMap, setTranslationMap] = useState<Record<number, string>>({});
  const lineCounterRef = useRef(0);
  const [indexedLines, setIndexedLines] = useState<{ idx: number; text: string }[]>([]);

  // Source language change handler
  const onSourceChange = (newLang: SpeechLang) => {
    if (newLang === targetLang) {
      // Auto-switch target to avoid same source and target
      const alternatives = LANG_OPTIONS.filter(l => l !== newLang);
      const newTarget = alternatives[0];
      setTargetLang(newTarget);
      localStorage.setItem(STORAGE_TARGET_LANG, newTarget);
    }
    setSourceLang(newLang);
    localStorage.setItem(STORAGE_SOURCE_LANG, newLang);
  };

  // Target language change handler
  const onTargetChange = (newLang: SpeechLang) => {
    if (newLang === sourceLang) {
      // Auto-switch source to avoid same source and target
      const alternatives = LANG_OPTIONS.filter(l => l !== newLang);
      const newSource = alternatives[0];
      setSourceLang(newSource);
      localStorage.setItem(STORAGE_SOURCE_LANG, newSource);
    }
    setTargetLang(newLang);
    localStorage.setItem(STORAGE_TARGET_LANG, newLang);
  };

  // Keep refs in sync and persist target language
  useEffect(() => {
    sourceLangRef.current = sourceLang;
    setTranslationMap({});
    setIndexedLines([]);
    lineCounterRef.current = 0;
    if (transcriptIdRef.current) {
      endTranscript(transcriptIdRef.current).catch(() => {});
      setTranscriptId(null);
      setIsRecording(false);
    }
  }, [sourceLang]);

  useEffect(() => {
    targetLangRef.current = targetLang;
    // Re-translate existing lines with new target (optional: clear instead)
    setTranslationMap({});
  }, [targetLang]);

  // Persist font size
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  // ── Speech recognition lifecycle ──────────────────────────────────────────

  useEffect(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    let stopped = false;
    const SRCtor = SR;

    function start() {
      if (stopped) return;

      const rec = new SRCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = sourceLangRef.current;

      rec.onstart = () => {
        setErrorMsg(null);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (event: any) => {
        let interimBuf = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            const text = (result[0].transcript as string).trim();
            if (text) {
              const idx = lineCounterRef.current++;
              setIndexedLines((prev) => {
                const next = [...prev, { idx, text }];
                return next.length > HISTORY_SIZE ? next.slice(next.length - HISTORY_SIZE) : next;
              });
              setInterim('');
              // Persist line to backend if recording
              if (transcriptIdRef.current) {
                apiAppendLine(transcriptIdRef.current, text).catch(() => {});
              }
              // Fire translation in background
              translateText(text, sourceLangRef.current, targetLangRef.current).then((translated) => {
                setTranslationMap((m) => ({ ...m, [idx]: translated }));
              }).catch(() => {});
            }
          } else {
            interimBuf += result[0].transcript as string;
          }
        }
        if (interimBuf) setInterim(interimBuf);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (event: any) => {
        if (event.error === 'aborted') return;
        if (event.error === 'no-speech') return;
        setErrorMsg(event.error as string);
        console.warn('SpeechRecognition error:', event.error);
      };

      rec.onend = () => {
        if (!stopped) {
          setTimeout(start, 150);
        }
      };

      recognitionRef.current = rec;
      try {
        rec.start();
      } catch (err) {
        console.warn('recognition.start() threw:', err);
      }
    }

    start();

    return () => {
      stopped = true;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, [sourceLang]);

  const displayLines = indexedLines;

  // ── Keyboard: Escape to minimize ─────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') minimizeWindow();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const historyFontSize = Math.round(fontSize * 0.68);
  const translationFontSize = Math.round(fontSize * 0.52);

  const adjustSize = (delta: number) => {
    setFontSize((prev) => Math.max(FONT_MIN, Math.min(FONT_MAX, prev + delta)));
  };

  const SR = getSpeechRecognition();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{
        background: 'rgba(10,10,10,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* ── Title bar (drag region) ── */}
      <div
        onMouseDown={startDragging}
        style={{ cursor: 'move', background: 'rgba(0,0,0,0.35)' }}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0"
      >
        <div 
          className="flex items-center gap-2 text-white/60 text-xs font-medium select-none"
        >
          <span>Live Transcription</span>
          {backendConnected === false && (
            <span className="flex items-center gap-1 text-yellow-400/70 text-[10px]">
              <WifiOff size={10} />
              <span>Backend offline</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={minimizeWindow}
            className="text-white/40 hover:text-white/90 transition-colors p-1 rounded"
            aria-label="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={handleClose}
            className="text-white/40 hover:text-red-400 transition-colors p-1 rounded"
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Transcript area ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-2 overflow-hidden">

        {!SR && (
          <p className="text-red-400 text-xl text-center">
            ⚠️ Speech recognition is not supported.<br />
            <span className="text-base opacity-70">This app requires Chrome or Edge engine.</span>
          </p>
        )}

        {SR && (
          <>
            {/* History lines */}
            <div className="flex flex-col items-center gap-1.5 w-full transcript-text">
              {(() => {
                const padded = Array.from({ length: HISTORY_SIZE }, (_, i) => {
                  const offset = displayLines.length - HISTORY_SIZE + i;
                  return offset >= 0 ? displayLines[offset] : null;
                });
                return padded.map((entry, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5 w-full">
                    <p
                      className="text-white text-center leading-tight truncate max-w-full transition-opacity duration-300"
                      style={{
                        fontSize: historyFontSize,
                        opacity: entry ? HISTORY_OPACITY[i] : 0,
                        textShadow: '0 1px 8px rgba(0,0,0,1), 0 0 16px rgba(0,0,0,0.9)',
                      }}
                    >
                      {entry?.text || '\u00A0'}
                    </p>
                    {showTranslation && entry && (
                      <p
                        className="text-yellow-300 text-center leading-tight truncate max-w-full transition-opacity duration-300"
                        style={{
                          fontSize: translationFontSize,
                          opacity: HISTORY_OPACITY[i] * 0.85,
                          textShadow: '0 1px 6px rgba(0,0,0,1)',
                        }}
                      >
                        {translationMap[entry.idx] ?? '…'}
                      </p>
                    )}
                  </div>
                ));
              })()}
            </div>

            {/* Current interim line */}
            <p
              className="text-white text-center leading-snug max-w-full transcript-text"
              style={{ fontSize, textShadow: '0 2px 12px rgba(0,0,0,1), 0 0 24px rgba(0,0,0,0.95)' }}
            >
              {interim || (
                <span className="opacity-35 italic">
                  {sourceLang === 'fr-FR' ? 'En attente…' : sourceLang === 'pt-BR' ? 'Aguardando…' : 'Listening…'}
                </span>
              )}
            </p>

            {errorMsg && (
              <p className="text-red-400 text-xs mt-1">⚠ {errorMsg}</p>
            )}
          </>
        )}
      </div>

      {/* ── Control bar ── */}
      <div
        style={{ background: 'rgba(0,0,0,0.30)' }}
        className="flex items-center justify-between px-4 py-2.5 border-t border-white/10 shrink-0 gap-3"
      >
        {/* Language selectors: Source → Target */}
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            value={sourceLang}
            onChange={(e) => onSourceChange(e.target.value as SpeechLang)}
            className="text-xs bg-neutral-800 border border-white/20 rounded px-1.5 py-1 text-white font-medium focus:outline-none focus:border-white/40 cursor-pointer"
            title="Speech recognition language"
          >
            {LANG_OPTIONS.map((l) => (
              <option key={l} value={l} className="bg-neutral-800 text-white">
                {LANGUAGES[l].short}
              </option>
            ))}
          </select>
          <span className="text-white/40 text-xs">→</span>
          <select
            value={targetLang}
            onChange={(e) => onTargetChange(e.target.value as SpeechLang)}
            className="text-xs bg-neutral-800 border border-white/20 rounded px-1.5 py-1 text-white font-medium focus:outline-none focus:border-white/40 cursor-pointer"
            title="Translation language"
          >
            {LANG_OPTIONS.map((l) => (
              <option key={l} value={l} className="bg-neutral-800 text-white">
                {LANGUAGES[l].short}
              </option>
            ))}
          </select>
        </div>

        {/* Translation toggle */}
        <button
          onClick={() => setShowTranslation((v) => !v)}
          title={showTranslation ? 'Hide translation' : 'Show translation'}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors shrink-0 ${
            showTranslation
              ? 'border-yellow-400/60 text-yellow-300 bg-yellow-400/10'
              : 'border-white/20 text-white/40 hover:bg-white/10'
          }`}
        >
          <Languages size={12} />
          <span>{LANGUAGES[targetLang].short}</span>
        </button>

        {/* Record toggle + session picker */}
        <div className="flex items-center gap-1.5">
          {(isRecording || sessions !== null) && (
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              disabled={isRecording}
              className="text-xs bg-white/10 border border-white/20 rounded px-1.5 py-1 text-white/70 focus:outline-none max-w-40 disabled:opacity-40"
            >
              <option value="">No specific session</option>
              {(sessions ?? []).map((s) => (
                <option key={s.session_id} value={s.session_id}>
                  {s.session_id}{s.title ? ` — ${s.title.substring(0, 28)}` : ''}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={toggleRecording}
            disabled={backendConnected === false}
            title={backendConnected === false ? 'Backend not connected' : isRecording ? 'Stop saving transcript' : 'Save transcript to database'}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors shrink-0 ${
              isRecording
                ? 'border-red-400/60 text-red-300 bg-red-400/10'
                : backendConnected === false
                  ? 'border-white/10 text-white/20 cursor-not-allowed'
                  : 'border-white/20 text-white/40 hover:bg-white/10'
            }`}
          >
            {isRecording ? <CircleDot size={12} /> : <Circle size={12} />}
            <span>{isRecording ? 'Saving…' : 'Save'}</span>
          </button>
        </div>

        {/* Font size */}
        <div className="flex items-center gap-0.5 ml-auto">
          <button
            onClick={() => adjustSize(-FONT_STEP)}
            disabled={fontSize <= FONT_MIN}
            className="p-1 rounded text-white/50 hover:text-white disabled:opacity-20 transition-colors"
          >
            <Minus size={12} />
          </button>
          <span className="text-white/40 text-xs w-9 text-center tabular-nums">{fontSize}px</span>
          <button
            onClick={() => adjustSize(FONT_STEP)}
            disabled={fontSize >= FONT_MAX}
            className="p-1 rounded text-white/50 hover:text-white disabled:opacity-20 transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Elapsed timer */}
        <span className="text-white/35 text-xs font-mono tabular-nums">{elapsed}</span>
      </div>
    </div>
  );
}
