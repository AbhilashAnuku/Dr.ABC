// Voice-commands cheat sheet — surface the parser's grammar so a new
// user knows what to say. Pulls VOICE_COMMANDS_HELP straight from
// global-voice.ts so this list cannot drift out-of-date — adding a
// branch in `parseCommand` and forgetting to update the array is the
// failure we want to prevent.
//
// v0.7 audit slice 5 — migrated to the <Modal> primitive. Native
// <dialog> + showModal() handles focus trap + Escape + ARIA modal
// for free. Group chips use <Pill>; the host parent owns the open
// boolean (top-bar's cheatOpen state).

import { Modal, Pill, cn } from '@dr-abc/ui';
import { Brain, Mic, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VOICE_COMMANDS_HELP, type VoiceCommandHelpEntry } from '../lib/global-voice.ts';

const GROUP_TONE: Record<
  VoiceCommandHelpEntry['group'],
  'accent' | 'success' | 'info' | 'warning'
> = {
  navigate: 'accent',
  consult: 'success',
  continuity: 'info',
  control: 'warning',
};

interface Props {
  onClose: () => void;
}

export function VoiceCommandsCheatSheet({ onClose }: Props) {
  const { t } = useTranslation();
  const GROUP_LABEL: Record<VoiceCommandHelpEntry['group'], string> = {
    navigate: t('voiceCheatSheet.groupNavigate'),
    consult: t('voiceCheatSheet.groupConsult'),
    continuity: t('voiceCheatSheet.groupContinuity'),
    control: t('voiceCheatSheet.groupControl'),
  };

  const grouped: Record<VoiceCommandHelpEntry['group'], VoiceCommandHelpEntry[]> = {
    navigate: [],
    consult: [],
    continuity: [],
    control: [],
  };
  for (const entry of VOICE_COMMANDS_HELP) {
    grouped[entry.group].push(entry);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('voiceCheatSheet.title')}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <Mic className="h-3 w-3" /> · {t('voiceCheatSheet.kicker')}
        </span>
      }
      size="lg"
      footer={
        <div className="font-mono text-[10px] text-app-faint">
          <div>
            <Brain className="mr-1 inline h-3 w-3 text-quantum-300" />
            {t('voiceCheatSheet.wakeWord')}{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5">Mörbius</code> /{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5">Doctor</code>
            <span className="mx-1.5 opacity-50">·</span>
            {t('voiceCheatSheet.armHint')}
          </div>
          <div className="mt-1">
            <Sparkles className="mr-1 inline h-3 w-3 text-bio-300" />
            {t('voiceCheatSheet.drawerHint')}{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5">⌘ ;</code> ·{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5">Ctrl ;</code> · {t('recents.esc')}.
          </div>
        </div>
      }
    >
      {(Object.keys(grouped) as VoiceCommandHelpEntry['group'][]).map((g) => (
        <div key={g} className={cn('mb-4 last:mb-0')}>
          <Pill tone={GROUP_TONE[g]} size="sm" className="mb-2">
            {GROUP_LABEL[g]}
          </Pill>
          <ul className="space-y-1.5">
            {grouped[g].map((entry) => (
              <li
                key={entry.phrase}
                className="rounded-lg border border-app-subtle bg-white/2 px-3 py-2"
              >
                <code className="font-mono text-[12px] text-app-primary">{entry.phrase}</code>
                <p className="mt-0.5 font-sans text-[11px] text-app-muted">{entry.description}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  );
}
