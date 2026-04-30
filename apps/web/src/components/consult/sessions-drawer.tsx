import { cn } from '@dr-abc/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { useCallback, useEffect, useState } from 'react';
import {
  type ConsultTurn,
  clearTranscript,
  listConsultIds,
  loadTranscript,
} from '../../lib/consult-transcript.ts';

/**
 * SessionsDrawer — slide-in panel listing every consult thread the
 * user has saved. Provides new chat, old chats, schedule chat, live
 * chat, clear chat, delete, and export-as-PDF. This component owns:
 *
 *   • New chat   → fires onNewChat (parent clears the active thread)
 *   • Old chats  → list of saved transcripts with delete + export PDF
 *   • Live chat  → the currently active thread (highlighted)
 *   • Schedule   → routes to /app/appointments (not handled here)
 *   • Clear      → wipes the active thread (parent's clearChat)
 *
 * Open/close controlled by the parent.
 */

interface SessionsDrawerProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  activeConsultId: string | null;
  onNewChat: () => void;
  onLoadChat: (consultId: string) => void;
}

interface SessionPreview {
  consultId: string;
  title: string;
  lastTs: number;
  turnCount: number;
}

function previewFromTurns(turns: ConsultTurn[]): { title: string; lastTs: number } {
  const firstPatient = turns.find((t) => t.role === 'patient');
  const title = firstPatient?.text.slice(0, 60) ?? 'Untitled consult';
  const lastTs = turns.length > 0 ? (turns[turns.length - 1]?.ts ?? Date.now()) : Date.now();
  return { title, lastTs };
}

function relTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

async function exportSessionAsPdf(userId: string, consultId: string, title: string): Promise<void> {
  const turns = loadTranscript(userId, consultId);
  if (turns.length === 0) return;

  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.04, 0.09, 0.18);
  const muted = rgb(0.34, 0.42, 0.56);
  const accent = rgb(0.06, 0.71, 0.51);

  const PAGE_W = 595.3;
  const PAGE_H = 841.9;
  const MARGIN = 48;
  const LINE = 13;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawText = (
    text: string,
    opts: { font?: typeof fontRegular; size?: number; color?: typeof ink; maxWidth?: number } = {},
  ) => {
    const font = opts.font ?? fontRegular;
    const size = opts.size ?? 10;
    const color = opts.color ?? ink;
    const maxWidth = opts.maxWidth ?? PAGE_W - MARGIN * 2;
    const words = text.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth) {
        if (y < MARGIN + LINE) {
          page = pdf.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        page.drawText(line, { x: MARGIN, y, size, font, color });
        y -= LINE;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      if (y < MARGIN + LINE) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size, font, color });
      y -= LINE;
    }
  };

  drawText('Dr·ABC · Mörbius', { font: fontBold, size: 18, color: accent });
  y -= 6;
  drawText(title, { font: fontBold, size: 13 });
  y -= 4;
  drawText(`Consult ID: ${consultId} · Exported ${new Date().toLocaleString()}`, {
    font: fontItalic,
    size: 9,
    color: muted,
  });
  y -= 14;

  for (const turn of turns) {
    const speaker = turn.role === 'mörbius' ? 'MÖRBIUS' : 'PATIENT';
    drawText(`${speaker} · ${new Date(turn.ts).toLocaleString()}`, {
      font: fontBold,
      size: 9,
      color: turn.role === 'mörbius' ? accent : muted,
    });
    drawText(turn.text, { size: 10 });
    y -= 6;
  }

  const bytes = await pdf.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `morbius-consult-${consultId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SessionsDrawer({
  open,
  onClose,
  userId,
  activeConsultId,
  onNewChat,
  onLoadChat,
}: SessionsDrawerProps) {
  const [sessions, setSessions] = useState<SessionPreview[]>([]);

  const refresh = useCallback(() => {
    if (!userId) return;
    const ids = listConsultIds(userId);
    const previews: SessionPreview[] = ids
      .map((cid) => {
        const turns = loadTranscript(userId, cid);
        if (turns.length === 0) return null;
        const { title, lastTs } = previewFromTurns(turns);
        return { consultId: cid, title, lastTs, turnCount: turns.length };
      })
      .filter((p): p is SessionPreview => p !== null)
      .sort((a, b) => b.lastTs - a.lastTs);
    setSessions(previews);
  }, [userId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleDelete = (consultId: string) => {
    if (!window.confirm('Delete this consult thread? This cannot be undone.')) return;
    clearTranscript(userId, consultId);
    refresh();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed left-0 top-0 bottom-0 z-50 flex w-full max-w-md flex-col border-r border-app-subtle bg-app-bg shadow-[0_0_40px_-10px_rgba(0,0,0,0.45)]"
          >
            <header className="flex items-center justify-between gap-4 border-b border-app-subtle px-5 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-bio-300" />
                <span className="font-display text-sm font-semibold text-app-primary">
                  Conversations
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close conversations panel"
                className="rounded-full border border-app-subtle bg-app-surface p-1.5 text-app-muted hover:text-app-primary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>

            <button
              type="button"
              onClick={() => {
                onNewChat();
                onClose();
              }}
              className="mx-5 mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-purple-400/40 bg-linear-to-r from-purple-500/15 via-fuchsia-500/15 to-blue-500/15 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-purple-200 transition hover:from-purple-500/25 hover:via-fuchsia-500/25 hover:to-blue-500/25"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {sessions.length === 0 ? (
                <p className="py-6 text-center font-grotesk text-sm text-app-muted">
                  No saved conversations yet. Start a chat to see it here.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {sessions.map((s) => {
                    const isActive = s.consultId === activeConsultId;
                    return (
                      <li
                        key={s.consultId}
                        className={cn(
                          'group flex items-start gap-2 rounded-xl border bg-app-surface/40 px-3 py-2.5 transition',
                          isActive
                            ? 'border-bio-400/50 bg-bio-500/10'
                            : 'border-app-subtle hover:border-quantum-400/40 hover:bg-app-surface',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onLoadChat(s.consultId);
                            onClose();
                          }}
                          className="flex-1 text-left"
                        >
                          <p className="font-grotesk text-sm text-app-primary line-clamp-2">
                            {s.title}
                          </p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                            {s.turnCount} turns · {relTime(s.lastTs)}
                          </p>
                        </button>
                        <div className="flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => void exportSessionAsPdf(userId, s.consultId, s.title)}
                            title="Export as PDF"
                            aria-label="Export consult as PDF"
                            className="rounded-md border border-app-subtle bg-app-surface p-1 text-app-muted hover:border-quantum-400/40 hover:text-quantum-300"
                          >
                            <Download className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(s.consultId)}
                            title="Delete this consult"
                            aria-label="Delete consult"
                            className="rounded-md border border-app-subtle bg-app-surface p-1 text-app-muted hover:border-rose-400/40 hover:text-rose-300"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="border-t border-app-subtle px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              Stored locally · IndexedDB · no upload
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
