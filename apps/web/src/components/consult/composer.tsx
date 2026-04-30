import { cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';
import { Camera, FileText, Mic, MicOff, Send } from 'lucide-react';
import { type FormEvent, useEffect, useRef } from 'react';
import { MicWaveform } from './mic-waveform.tsx';

/**
 * Composer — sticky-bottom multimodal input for the consult page.
 *
 * ChatGPT / Gemini grade:
 *   - Large rounded-3xl text input with auto-grow
 *   - Mic button morphs the input into a "listening" waveform
 *   - Inline attachment icons (camera · PDF) for multimodal turns
 *   - Send button on the right · gradient ring on focus
 *   - Submit on Enter (Shift+Enter for newline)
 *
 * The parent owns all state (input · listening · disabled). This
 * component is pure presentation.
 */

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onToggleListen: () => void;
  onAttachImage?: () => void;
  onAttachPdf?: () => void;
  listening: boolean;
  disabled: boolean;
  placeholder?: string;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onToggleListen,
  onAttachImage,
  onAttachPdf,
  listening,
  disabled,
  placeholder,
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea up to ~6 lines. `value` triggers the re-measure
  // even though the ref-touch isn't a React-state read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the render trigger that drives the resize
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, 200);
    el.style.height = `${next}px`;
  }, [value]);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (disabled || !value.trim()) return;
    onSubmit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky bottom-0 z-10 mx-auto w-full max-w-2xl px-4 pb-4 pt-2 sm:px-6"
    >
      <motion.div
        animate={{
          boxShadow: listening
            ? '0 0 0 2px rgba(168,85,247,0.4), 0 12px 50px -16px rgba(168,85,247,0.5)'
            : '0 0 0 1px rgba(255,255,255,0.08), 0 8px 30px -10px rgba(0,0,0,0.5)',
        }}
        transition={{ duration: 0.25 }}
        className={cn(
          'relative flex flex-col gap-2 overflow-hidden rounded-3xl border border-app-subtle bg-app-surface-strong px-4 py-2.5 backdrop-blur-2xl backdrop-saturate-150',
          'shadow-[0_8px_30px_-10px_rgba(0,0,0,0.15),0_2px_6px_-2px_rgba(0,0,0,0.08)]',
          'focus-within:border-quantum-400/60 focus-within:shadow-[0_0_0_2px_rgba(56,189,248,0.35),0_8px_30px_-10px_rgba(56,189,248,0.4)]',
        )}
      >
        {/* Listening overlay */}
        {listening && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 px-1"
          >
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-purple-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
              </span>
              Listening
            </span>
            <MicWaveform listening className="flex-1" />
          </motion.div>
        )}

        {/* Textarea (hidden during listening so the waveform owns the row) */}
        {!listening && (
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Describe your symptoms, ask a question, or say hello…'}
            rows={1}
            disabled={disabled}
            className="min-h-[40px] w-full resize-none bg-transparent px-1 py-1 font-grotesk text-base text-app-primary placeholder:text-app-muted focus:outline-none disabled:opacity-60 sm:text-[17px]"
          />
        )}

        {/* Toolbar row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <ToolButton
              onClick={onToggleListen}
              label={listening ? 'Stop listening' : 'Voice input'}
              tone={listening ? 'purple' : 'default'}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </ToolButton>
            {onAttachImage && (
              <ToolButton onClick={onAttachImage} label="Attach image">
                <Camera className="h-4 w-4" />
              </ToolButton>
            )}
            {onAttachPdf && (
              <ToolButton onClick={onAttachPdf} label="Attach PDF">
                <FileText className="h-4 w-4" />
              </ToolButton>
            )}
          </div>
          <motion.button
            type="submit"
            disabled={disabled || !value.trim()}
            whileHover={{ scale: disabled || !value.trim() ? 1 : 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Send"
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full border transition-all',
              !disabled && value.trim()
                ? 'border-white/15 bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-[0_4px_20px_-6px_rgba(139,92,246,0.65)] hover:from-purple-500 hover:to-blue-500'
                : 'border-white/10 bg-white/5 text-app-faint',
            )}
          >
            <Send className="h-4 w-4" />
          </motion.button>
        </div>
      </motion.div>

      <p className="mt-2 px-1 text-center font-mono text-[10px] tracking-[0.12em] text-app-faint">
        Mörbius is not a clinical decision tool · for urgent symptoms call 112 / 911
      </p>
    </form>
  );
}

interface ToolButtonProps {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  tone?: 'default' | 'purple';
}

function ToolButton({ onClick, label, children, tone = 'default' }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
        tone === 'purple'
          ? 'border-purple-400/50 bg-purple-500/15 text-purple-200 hover:bg-purple-500/25'
          : 'border-white/10 bg-white/[0.04] text-app-muted hover:border-white/20 hover:bg-white/[0.08] hover:text-app-primary',
      )}
    >
      {children}
    </button>
  );
}
