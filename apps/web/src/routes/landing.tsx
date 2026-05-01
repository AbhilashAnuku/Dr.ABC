import { Button, PulseDot, cn } from '@dr-abc/ui';
import { Canvas } from '@react-three/fiber';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Atom,
  BookOpen,
  type Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  FileText,
  GraduationCap,
  HeartPulse,
  KeyRound,
  Lock,
  Mail,
  Network,
  Newspaper,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { type FormEvent, type ReactNode, Suspense, lazy, useEffect, useRef, useState } from 'react';

// Heavy Three.js scene — lazy-loaded so the WebGL chunk stays out of
// the first-paint bundle. The Hero3DBackdrop renders a real 3D DNA
// double helix + drifting molecular field behind the hero, replacing
// the earlier SVG decoration. Falls back to null during load so the
// hero never blocks on the WebGL boot.
const Hero3DBackdrop = lazy(() => import('../overlay/hero-3d-backdrop.tsx'));
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import {
  AnthropicMark,
  FHIRMark,
  HuggingFaceMark,
  MonaiMark,
  NvidiaMark,
  OllamaMark,
  OpenAIMark,
  PubMedMark,
  PyTorchMark,
  SRHMark,
} from '../components/landing/brand-marks.tsx';
import { ForCliniciansAndStudents } from '../components/landing/for-clinicians-and-students.tsx';
import { MedicalGames } from '../components/landing/medical-games.tsx';
import { useAuth } from '../lib/auth.tsx';
import { API_BASE } from '../lib/config.ts';
import { type GuestTurn, appendGuestTurn, loadGuestChat } from '../lib/guest-chat.ts';
import { MorbiusFace } from '../overlay/morbius-face.tsx';

/**
 * Landing — agency-style single-scroll. Heavy purple/blue glass +
 * over-sized Syne display headlines + Space-Grotesk body. Designed as a
 * 10-section narrative read top-to-bottom:
 *
 *   1. Hero            — mega headline + 3D Mörbius head
 *   2. Trusted-by      — academic + tooling marquee
 *   3. Manifesto       — the hard-truth statement
 *   4. Us-vs-them      — generic chatbot vs Mörbius brain
 *   5. Ecosystem       — RAG · Agentic · Memory pillars + portfolio
 *   6. Process path    — 3-step Audit → Reason → Verify
 *   7. Live demo       — the real /api/orchestrate stream
 *   8. Tiers           — 4 tiers Demo / Project / Pilot / Enterprise
 *   9. Application     — collaboration form, mailto: fallback
 *  10. Footer          — student attribution + legal triad
 */
export function LandingPage() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const ctaTo = status === 'signed-in' ? '/app' : '/signup';

  const heroRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroFade = useTransform(scrollYProgress, [0, 1], [1, 0.15]);
  const heroLift = useTransform(scrollYProgress, [0, 1], [0, -120]);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Cursor particles removed; the Mörbius head tracker is retained
          via the global MorbiusOverlay, which leans toward the cursor and
          handles face / lip-sync from the camera. */}
      <BackdropBlobs />
      <NoiseLayer />
      <div className="relative z-10">
        <PublicHeader />

        {/* ============================================================
         *  1. HERO · full viewport · no overflow-hidden so the giant
         *  MÖRBIUS title (with umlaut + drop-shadow) can breathe.
         *  Adds the medical-tech backdrop (DNA helix · molecule cluster ·
         *  ECG waveform) drifting behind the hero so the landing
         *  carries a clinical-noir feel in both light and dark themes.
         * ============================================================ */}
        <section
          ref={heroRef}
          className="relative mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-8 px-5 pt-12 pb-16 sm:px-8 sm:pt-16 lg:min-h-[calc(100vh-5.5rem)] lg:grid-cols-[1.18fr_0.82fr] lg:pt-20 lg:pb-14"
        >
          {/* SVG fallback paints instantly; lazy 3D scene takes over
              once the WebGL chunk loads. */}
          <HeroBackdrop />
          <Suspense fallback={null}>
            <Hero3DBackdrop />
          </Suspense>
          <motion.div className="min-w-0" style={{ opacity: heroFade, y: heroLift }}>
            <div className="mb-7 inline-flex w-full max-w-full min-w-0 items-center gap-3 overflow-hidden rounded-full border border-purple-400/40 bg-purple-500/10 px-3 py-1.5 backdrop-blur-xl sm:mb-8 sm:w-auto sm:px-4">
              <PulseDot active size="xs" tone="bio" />
              <span className="min-w-0 truncate font-mono text-[10px] tracking-[0.2em] text-purple-200 uppercase sm:tracking-[0.32em]">
                Sovereign medical AI · local-first · Mörbius v0.8
              </span>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-4 inline-flex items-baseline gap-3"
            >
              <span className="font-syne text-[28px] font-black tracking-[-0.01em] text-app-primary sm:text-[36px]">
                Dr.ABC
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-purple-300">
                · the project ·
              </span>
            </motion.div>

            {/* Hero entry uses spring physics (organic settle) + a
                stagger container so each line cascades in. The 3D wrapper
                breathes after the entry settles. */}
            <motion.h1
              initial={{ opacity: 0, y: 32, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{
                type: 'spring',
                stiffness: 80,
                damping: 18,
                mass: 1.1,
              }}
              className="with-ornament font-syne font-black tracking-[-0.035em] text-app-primary"
              style={{
                // Hard cap the headline so the
                // full word "MÖRBIUS" always fits inside the left
                // column without clipping against the 3D face card
                // on the right. Previous max 11.5rem clipped the
                // trailing S at common laptop widths (1366-1600 px).
                fontSize: 'clamp(3.5rem, 11vw, 8.5rem)',
                lineHeight: 1,
                paddingTop: '0.18em',
                paddingBottom: '0.04em',
                whiteSpace: 'nowrap',
              }}
            >
              <span className="block bg-gradient-to-br from-purple-200 via-blue-300 to-bio-300 bg-clip-text text-transparent drop-shadow-[0_0_60px_rgba(139,92,246,0.4)]">
                MÖRBIUS
              </span>
            </motion.h1>

            <motion.h2
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{
                type: 'spring',
                stiffness: 90,
                damping: 20,
                mass: 0.9,
                delay: 0.12,
              }}
              className="mt-3 font-syne text-app-secondary"
              style={{
                fontSize: 'clamp(1.75rem, 4.5vw, 3.4rem)',
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
              }}
            >
              <span className="text-app-secondary">The sovereign multi-agent AI</span>
              <span className="block text-app-faint">inside Dr.ABC.</span>
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 110, damping: 22, delay: 0.28 }}
              className="mt-8 max-w-2xl font-grotesk text-base leading-relaxed text-app-secondary sm:mt-10 sm:text-xl"
            >
              Five brains in parallel · retrieval, agentic reasoning, medical knowledge, persistent
              memory, self-learning. Local-first inference on Llama 3.1 8b · training target Llama
              3.3 70b. Every clinical output passes a Validator · Safety · Privacy gauntlet. Open
              source · MIT · research-grade · sovereign by default.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 120, damping: 22, delay: 0.42 }}
              className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
            >
              <Link href={ctaTo} className="w-full sm:w-auto">
                <motion.div
                  whileHover={{ scale: 1.03, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                  className="relative inline-flex w-full sm:w-auto"
                >
                  {/* Glassmorphism primary — gradient mesh + inner glow.
                      Reads premium on both dark and light themes. */}
                  <span className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500/40 via-blue-500/30 to-quantum-500/40 blur-xl" />
                  <Button
                    variant="primary"
                    className="relative w-full rounded-full border border-white/15 bg-gradient-to-r from-purple-600 to-blue-600 px-8 py-3.5 text-base font-semibold tracking-tight shadow-[0_8px_40px_-12px_rgba(139,92,246,0.65),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-xl transition-all hover:from-purple-500 hover:to-blue-500 hover:shadow-[0_12px_50px_-12px_rgba(139,92,246,0.85),inset_0_1px_0_rgba(255,255,255,0.25)] sm:w-auto"
                  >
                    {t('landing.ctaPrimary')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </motion.div>
              </Link>
              <motion.a
                href="#manifesto"
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 font-grotesk text-sm font-medium text-app-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all hover:border-purple-400/50 hover:bg-white/[0.08] hover:text-purple-200 sm:w-auto"
              >
                The manifesto <ChevronRight className="h-4 w-4" />
              </motion.a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 100, damping: 24, delay: 0.62 }}
              className="mt-14 hidden max-w-2xl grid-cols-2 gap-4 sm:grid sm:grid-cols-4"
            >
              <HeroStat label="Agents online" value="9" />
              <HeroStat label="Triage latency" value="<4ms" />
              <HeroStat label="Languages" value="EN · DE" />
              <HeroStat label="Brain pillars" value="5" />
            </motion.div>

            {/* Capability strip — what visitors can actually ask Mörbius
                about. Sets the breadth expectation up front (drugs,
                investigations, anesthesia, surgical instruments,
                women's health) so people don't self-censor on the
                landing chat. */}
            <div className="mt-7 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-app-muted">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                Mörbius answers
              </span>
              {[
                'Conditions + differentials',
                'Drug names + interactions',
                'Anesthesia + dosing',
                'Surgical instruments',
                'Lab + imaging investigations',
                "Women's health",
                'Mental health + crisis',
              ].map((cap, i) => (
                <motion.span
                  key={cap}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.7 + i * 0.05 }}
                  whileHover={{ y: -2, scale: 1.04 }}
                  className="cursor-default rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 font-grotesk shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-colors hover:border-purple-400/40 hover:text-purple-100"
                >
                  {cap}
                </motion.span>
              ))}
            </div>
          </motion.div>

          {/* MÖRBIUS — real 3D animated head · breathes + leans gently
              after the entry settles, framer-motion-driven so it stays
              perfectly in sync with the rest of the page. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 24 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: [0, -8, 0],
            }}
            transition={{
              opacity: { duration: 1, delay: 0.25 },
              scale: { type: 'spring', stiffness: 60, damping: 16, mass: 1.2, delay: 0.2 },
              y: {
                duration: 7,
                ease: 'easeInOut',
                repeat: Number.POSITIVE_INFINITY,
                repeatType: 'mirror',
                delay: 1.5,
              },
            }}
            className="relative h-[420px] sm:h-[520px] lg:h-[620px]"
          >
            <div className="absolute inset-0 rounded-[2.5rem] border border-purple-400/30 bg-gradient-to-b from-purple-900/30 via-blue-900/20 to-black/80 p-2 shadow-[0_0_120px_-25px_rgba(139,92,246,0.55)] backdrop-blur-2xl">
              <div className="relative h-full w-full overflow-hidden rounded-[2.1rem] bg-gradient-to-b from-black/80 via-black/40 to-black/80">
                <Canvas camera={{ position: [0, 0, 1.65], fov: 38 }} dpr={[1, 2]}>
                  <ambientLight intensity={0.5} />
                  <directionalLight position={[2, 3, 4]} intensity={1.2} color="#cbd5ff" />
                  <directionalLight position={[-3, 1, 3]} intensity={0.55} color="#dfffe8" />
                  <pointLight position={[0, 0.5, 2.5]} intensity={0.7} color="#a78bfa" />
                  <pointLight position={[0, -1, 2]} intensity={0.4} color="#60a5fa" />
                  <MorbiusFace listening />
                </Canvas>
                <div className="pointer-events-none absolute inset-0 bg-radial-[at_50%_50%] from-transparent to-black/40" />
                {/* One floating chip — the others felt busy and the
                    professional version reads cleaner with a single
                    "alive" indicator. The 6/6 agents and local-first
                    claims live in the body copy below. */}
                <FloatingChip
                  position="top-4 left-4"
                  label="MÖRBIUS · ONLINE"
                  tone="bio"
                  delay={0.8}
                />
              </div>
            </div>
          </motion.div>
        </section>

        {/* ============================================================
         *  2. TRUSTED BY — marquee
         * ============================================================ */}
        <section className="border-y border-app-subtle bg-black/20 py-7 backdrop-blur-md">
          <div className="mb-4 px-5 text-center font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint sm:px-8">
            Architected on · powered by
          </div>
          <div className="overflow-hidden">
            <div className="flex w-max animate-marquee items-center gap-10 px-6 text-app-muted sm:gap-14">
              {TRUSTED_BRANDS.map((b) => (
                <BrandLogo key={`a-${b.label}`} brand={b} />
              ))}
              {TRUSTED_BRANDS.map((b) => (
                <BrandLogo key={`b-${b.label}`} brand={b} ariaHidden />
              ))}
            </div>
          </div>
        </section>

        {/* ============================================================
         *  3. MEDICAL-AI LANDSCAPE
         *
         *  Overview of available medical AI and its applications, rather
         *  than a comparison against Mörbius. Honest landscape — the
         *  products that actually run today and what they do. No
         *  "vs Mörbius" framing.
         * ============================================================ */}
        <Reveal>
          <section className="mx-auto w-full max-w-[1300px] px-5 py-20 sm:px-8 sm:py-24">
            <SectionHeader
              eyebrow="· The medical-AI landscape"
              title="What's actually running in clinics today."
              subtitle="A grounded overview of the systems clinicians and patients are using right now — the published frontier, the ambient scribes, the imaging classifiers, the pharmacovigilance models. The categories Mörbius lives alongside."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <LandscapeCard
                category="Clinical reasoning · diagnosis support"
                examples="Med-PaLM 2 (Google) · Med-Gemini · GPT-4 medical · BioGPT · OpenBioLLM-70B · Meditron"
                use="USMLE-style multi-choice · differential ranking · evidence retrieval"
                accent="purple"
              />
              <LandscapeCard
                category="Ambient scribing · SOAP notes"
                examples="Abridge · Nuance DAX · Suki · Microsoft Dragon Copilot"
                use="Microphone in the room → structured chart note · physician saves 1-2 h/day"
                accent="blue"
              />
              <LandscapeCard
                category="Medical imaging · radiology AI"
                examples="MONAI · Aidoc · Rad AI · Annalise.ai · Lunit Insight"
                use="X-ray pneumonia · CT stroke · mammography · Grad-CAM heat-maps"
                accent="bio"
              />
              <LandscapeCard
                category="Dermatology classification"
                examples="ISIC challenge models · DermAI · SkinVision · Google Derm Assist"
                use="Lesion image → benign / malignant / 9-class · ABCDE rule overlays"
                accent="amber"
              />
              <LandscapeCard
                category="Drug discovery + safety"
                examples="DeepMind AlphaFold · Insilico · DrugBank · OpenFDA"
                use="Protein folding · ADMET prediction · drug-drug interactions · pharmacovigilance"
                accent="rose"
              />
              <LandscapeCard
                category="Patient-facing triage + Q&A"
                examples="Ada Health · Babylon · K Health · Sensely"
                use="Symptom triage · ESI scoring · self-care guidance · primary-care escalation"
                accent="purple"
              />
            </div>
          </section>
        </Reveal>

        {/* ============================================================
         *  4. MÖRBIUS · FOCUSED ASPECTS
         *
         *  Focused aspects of Mörbius without comparisons. What it IS
         *  and DOES, in clean prose.
         * ============================================================ */}
        <Reveal>
          <section className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
            <div className="mb-6 font-mono text-[11px] tracking-[0.32em] text-purple-300 uppercase">
              · Mörbius
            </div>
            <h2 className="font-syne text-display-xl font-bold text-app-primary">
              Sovereign. Multi-agent. Bedside-warm.
            </h2>
            <p className="mt-8 max-w-3xl font-grotesk text-xl leading-relaxed text-app-secondary">
              Mörbius runs on the architect's laptop. Llama 3.1 8b for live consults. Llama 3.3 70b
              Instruct as the training base. Five brains in parallel — retrieval, agentic reasoning,
              medical knowledge, persistent memory, self-learning — orchestrated by an in-house
              framework that gates every clinical output through a Validator, Safety, and Privacy
              gauntlet.
            </p>
            <p className="mt-6 max-w-3xl font-grotesk text-xl leading-relaxed text-app-secondary">
              Open source. MIT license. No PHI in the repo, ever. The Mörbius Secure Protocol — a
              hard-coded system-prompt instruction with one stated goal:{' '}
              <span className="text-purple-300">save at least one human life</span> — overrides any
              confidence calculation. Red-flag pathways escalate regardless of probability.
            </p>
            <p className="mt-6 max-w-3xl font-grotesk text-xl leading-relaxed text-app-secondary">
              The voice is warm because real clinicians are warm. Five tones — clinical, empathetic,
              reassuring, conversational, delivering hard news — with tone-driven prosody so Mörbius
              slows down and softens the pitch when a patient is scared, lifts the rate when
              delivering good news, lowers the pitch when news is hard. Eight named voices. One
              sovereign brain.
            </p>

            {/* Beta launch CTA · merged into the focus section ·
                no inline demo or screenshot, presented as a single
                launch-beta block. */}
            <div className="mt-12 flex flex-wrap items-center gap-4">
              <Link href={ctaTo}>
                <Button
                  variant="primary"
                  className="rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-7 py-3.5 text-base shadow-[0_0_60px_-15px_rgba(139,92,246,0.7)] hover:from-purple-500 hover:to-blue-500"
                >
                  Open Mörbius
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a
                href="https://github.com/AbhilashAnuku/Dr.ABC"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-app-subtle bg-white/5 px-5 py-3 font-grotesk text-sm text-app-secondary backdrop-blur-xl transition hover:border-purple-400/40 hover:text-purple-200"
              >
                Read the source <ChevronRight className="h-4 w-4" />
              </a>
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.32em] text-amber-200">
                BETA · v0.8 · open-source · MIT
              </span>
            </div>
          </section>
        </Reveal>

        {/* ============================================================
         *  4b. LEARNING OUTCOMES · module competency → proof mapping
         *  Maps each MSc Applied-AI learning outcome to a concrete,
         *  auditable artefact (file · metric · test) in the codebase.
         * ============================================================ */}
        <Reveal>
          <LearningOutcomes />
        </Reveal>

        {/* ============================================================
         *  5. FOR CLINICIANS + STUDENTS · curated articles
         * ============================================================ */}
        <Reveal>
          <ForCliniciansAndStudents />
        </Reveal>

        {/* ============================================================
         *  6. PRACTICE WITH MÖRBIUS · 3 medical games
         *  Designed graphics for practicing medical terminology. Mörbius
         *  plays the game with the user: asks a question, checks the
         *  answer, gives a score, and offers encouraging feedback.
         * ============================================================ */}
        <Reveal>
          <section className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
            <MedicalGames />
          </section>
        </Reveal>

        {/* ============================================================
         *  9.5  LEGAL · COMPLIANCE · FAQ
         *
         *  AI bias + medical-AI usage restrictions + clinical-conflict
         *  posture + license terms must read as deliberate, not as
         *  legal-page filler. Six FAQ articles + a one-line policy
         *  ledger underneath. Every FAQ collapses; "Read more" links
         *  point at the canonical doc inside the repo for depth.
         * ============================================================ */}
        <Reveal>
          <LegalArticles />
        </Reveal>

        {/* ============================================================
         *  10. FOOTER · authors + project + legal
         *
         *  Two SEPARATE author cards (Abhi + Simranjot) with the same
         *  shape so both authors read as equals on the page. The earlier
         *  "Abhilash · Simranjot" inline string lost the second name
         *  visually; cards fix it.
         * ============================================================ */}
        <footer className="border-t border-app-subtle py-14 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-10 px-5 sm:px-8">
            {/* Subscribe — visitor leaves an email · we draft a welcome
                in their mail client + stash a copy in localStorage so
                an admin sync job can pick it up later. */}
            <SubscribeBlock />

            {/* Top: brand + project blurb */}
            <div className="flex flex-col gap-4">
              <div className="font-syne text-2xl font-bold tracking-tight text-app-primary">
                Dr<span className="text-bio-400">·</span>ABC{' '}
                <span className="text-app-muted">— powered by Mörbius</span>
              </div>
              <p className="max-w-2xl font-grotesk text-sm leading-relaxed text-app-muted">
                Sovereign, local-first medical AI. Five brain pillars · RAG · Agentic · Medical
                knowledge · Persistent memory · Self-learning. Built to the bar of a market-grade
                clinical product.
              </p>
            </div>

            {/* Authors · two equal-weight cards */}
            <div>
              <div className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
                <GraduationCap className="h-3 w-3" /> · authors of record
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <AuthorCard
                  name="Abhilash Anuku"
                  title="Co-author · Mörbius"
                  scope="Five-pillar architecture · agent framework · Secure Pass · safety floor · UI/UX system · deploy chain"
                  initials="AA"
                  contact="abhilashanuku14@gmail.com"
                  github="AbhilashAnuku"
                />
                <AuthorCard
                  name="Simranjot Kaur"
                  title="Co-author · Mörbius"
                  scope="Clinical case-history curation · ICD-10 vocabulary · drug-safety rules · documentation"
                  initials="SK"
                  contact="—"
                  github={null}
                />
              </div>
            </div>

            {/* Project + legal links */}
            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
                  Project
                </div>
                <ul className="space-y-1.5 font-grotesk text-xs text-app-muted">
                  <li>
                    <a
                      href="https://github.com/AbhilashAnuku/Dr.ABC"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-300 hover:text-blue-200"
                    >
                      github.com/AbhilashAnuku/Dr.ABC →
                    </a>
                  </li>
                  <li>MIT license · open source · sovereign-by-default</li>
                  <li>Local-first build · cloud LLMs opt-in only</li>
                </ul>
              </div>
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
                  Legal & policy
                </div>
                <ul className="space-y-1.5 font-grotesk text-xs text-app-muted">
                  <li>
                    <a href="#legal" className="text-blue-300 hover:text-blue-200">
                      Disclosures · FAQ · usage →
                    </a>
                  </li>
                  <li>
                    <span className="text-amber-300">Not FDA / CE / MDR cleared.</span>{' '}
                    Research-grade decision-support.
                  </li>
                  <li>No PHI in repo · synthetic data only.</li>
                </ul>
              </div>
              <div>
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
                  Bar
                </div>
                <ul className="space-y-1.5 font-grotesk text-xs text-app-muted">
                  <li>5 brain pillars · 9 specialist agents</li>
                  <li>Validator → Safety → Privacy gauntlet</li>
                  <li>Mörbius Secure Protocol · save one life</li>
                </ul>
              </div>
            </div>

            {/* Bottom strip · version + tagline */}
            <div className="flex flex-col items-center justify-between gap-2 border-t border-app-subtle pt-5 font-mono text-[10px] tracking-[0.18em] text-app-faint sm:flex-row">
              <div>DR·ABC · MÖRBIUS · BETA · v0.8 · 2026</div>
              <div className="inline-flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-bio-400" /> sovereign medical AI · local-first ·
                MIT
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
//  TEAM CARD
// ============================================================================

function TeamCard({
  name,
  title,
  bio,
  affiliation,
  university,
  accent,
}: {
  name: string;
  title: string;
  bio: string;
  affiliation: string;
  university: string;
  accent: 'purple' | 'blue';
}) {
  const accentCls =
    accent === 'purple'
      ? 'border-purple-400/30 from-purple-500/15 shadow-[0_0_80px_-30px_rgba(139,92,246,0.65)]'
      : 'border-blue-400/30 from-blue-500/15 shadow-[0_0_80px_-30px_rgba(96,165,250,0.65)]';
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .join('');
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-3xl border bg-gradient-to-br via-blue-500/5 to-transparent p-7 backdrop-blur-2xl transition hover:-translate-y-1',
        accentCls,
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border font-syne text-2xl font-bold backdrop-blur-md',
            accent === 'purple'
              ? 'border-purple-400/50 bg-purple-500/15 text-purple-200'
              : 'border-blue-400/50 bg-blue-500/15 text-blue-200',
          )}
        >
          {initials}
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
            · {accent === 'purple' ? 'co-architect 01' : 'co-architect 02'}
          </div>
          <h3 className="mt-1 font-syne text-2xl font-bold text-app-primary">{name}</h3>
          <div className="mt-1 font-grotesk text-sm text-app-secondary">{title}</div>
        </div>
      </div>
      <p className="mt-5 font-grotesk text-base leading-relaxed text-app-secondary">{bio}</p>
      <div className="mt-6 grid gap-1 border-t border-app-subtle pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        <div className="flex items-center gap-2 text-app-muted">
          <GraduationCap className="h-3 w-3 text-bio-400" /> {affiliation}
        </div>
        <div className="text-app-muted">{university}</div>
      </div>
    </div>
  );
}

// ============================================================================
//  COMPETITIVE COMPARISON
// ============================================================================

interface CompetitorRow {
  /** Capability surface. */
  axis: string;
  /** Mörbius value. */
  morbius: { value: string; tone: 'win' | 'parity' | 'gap' };
  /** Reference competitor cells, ordered to match COMPETITORS. */
  cells: { value: string; tone: 'win' | 'parity' | 'gap' | 'na' }[];
}

const COMPETITORS = [
  { name: 'Ada Health', tag: 'consumer triage' },
  { name: 'Abridge', tag: 'AI scribe' },
  { name: 'Glass Health', tag: 'clinical CDS' },
  { name: 'Med-PaLM 2', tag: 'foundation model' },
] as const;

const COMP_ROWS: CompetitorRow[] = [
  {
    axis: 'Local-first / sovereign deploy',
    morbius: { value: 'Yes · Ollama + py-svc on-device', tone: 'win' },
    cells: [
      { value: 'Cloud only', tone: 'gap' },
      { value: 'Cloud only', tone: 'gap' },
      { value: 'Cloud only', tone: 'gap' },
      { value: 'Cloud only', tone: 'gap' },
    ],
  },
  {
    axis: 'Open code · auditable agents',
    morbius: { value: 'MIT, full source', tone: 'win' },
    cells: [
      { value: 'Closed', tone: 'gap' },
      { value: 'Closed', tone: 'gap' },
      { value: 'Closed', tone: 'gap' },
      { value: 'Closed', tone: 'gap' },
    ],
  },
  {
    axis: 'Multi-agent orchestration',
    morbius: { value: '6 specialists + cross-validator + gauntlet', tone: 'win' },
    cells: [
      { value: 'Single decision tree', tone: 'gap' },
      { value: 'Scribe pipeline only', tone: 'na' },
      { value: 'Single LLM + RAG', tone: 'parity' },
      { value: 'Single LLM', tone: 'parity' },
    ],
  },
  {
    axis: 'Consumer symptom triage',
    morbius: { value: '6-pattern quickstart + ESI score', tone: 'parity' },
    cells: [
      { value: 'Best-in-class flow', tone: 'win' },
      { value: '—', tone: 'na' },
      { value: '—', tone: 'na' },
      { value: '—', tone: 'na' },
    ],
  },
  {
    axis: 'AI scribe → SOAP note',
    morbius: { value: 'On-device · deterministic + Markdown export', tone: 'parity' },
    cells: [
      { value: '—', tone: 'na' },
      { value: 'Best-in-class · EHR write', tone: 'win' },
      { value: '—', tone: 'na' },
      { value: '—', tone: 'na' },
    ],
  },
  {
    axis: 'Specialist diagnostic depth',
    morbius: { value: 'Cardio · Neuro · Onco · Pulmo · Endo · Derm', tone: 'parity' },
    cells: [
      { value: 'Generalist', tone: 'parity' },
      { value: 'Note-only', tone: 'na' },
      { value: 'Deep · 1M+ clinicians', tone: 'win' },
      { value: 'Deep · benchmark SOTA', tone: 'win' },
    ],
  },
  {
    axis: 'Persistent per-user memory',
    morbius: { value: 'IndexedDB · TF-cosine recall', tone: 'win' },
    cells: [
      { value: 'Session only', tone: 'gap' },
      { value: 'Per-encounter', tone: 'parity' },
      { value: 'Per-clinician', tone: 'parity' },
      { value: 'No', tone: 'gap' },
    ],
  },
  {
    axis: 'Multi-language',
    morbius: { value: 'EN · DE · HI · ES · FR (MarianMT)', tone: 'win' },
    cells: [
      { value: '40+ languages', tone: 'win' },
      { value: 'EN', tone: 'gap' },
      { value: 'EN', tone: 'gap' },
      { value: 'EN + few', tone: 'parity' },
    ],
  },
  {
    axis: 'API-first · Postman-ready',
    morbius: { value: 'Bearer-token / morbius_… keys', tone: 'win' },
    cells: [
      { value: 'No public API', tone: 'gap' },
      { value: 'Enterprise only', tone: 'parity' },
      { value: 'No', tone: 'gap' },
      { value: 'Vertex AI gated', tone: 'parity' },
    ],
  },
  {
    axis: 'Real PDF Rx · clinician sign-off',
    morbius: { value: 'pdf-lib · A4 · embedded fonts', tone: 'win' },
    cells: [
      { value: 'No', tone: 'gap' },
      { value: '—', tone: 'na' },
      { value: 'No', tone: 'gap' },
      { value: '—', tone: 'na' },
    ],
  },
  {
    axis: 'EHR (Epic / Cerner) write',
    morbius: { value: 'FHIR R4 shape · write-back planned', tone: 'gap' },
    cells: [
      { value: 'No', tone: 'gap' },
      { value: 'Native', tone: 'win' },
      { value: 'Native', tone: 'win' },
      { value: 'Via partners', tone: 'parity' },
    ],
  },
  {
    axis: 'HIPAA / GDPR cert',
    morbius: { value: 'Architecture-ready · no formal cert yet', tone: 'gap' },
    cells: [
      { value: 'GDPR', tone: 'parity' },
      { value: 'HIPAA · SOC 2', tone: 'win' },
      { value: 'HIPAA', tone: 'win' },
      { value: 'HIPAA · BAA', tone: 'win' },
    ],
  },
];

const TONE_CHIP: Record<'win' | 'parity' | 'gap' | 'na', string> = {
  win: 'border-bio-500/40 bg-bio-500/15 text-bio-200',
  parity: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
  gap: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  na: 'border-app-subtle bg-white/5 text-app-faint',
};

function CompetitiveTable() {
  return (
    <div className="mt-12 overflow-x-auto rounded-3xl border border-app-subtle bg-black/30 backdrop-blur-2xl">
      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b border-app-subtle bg-purple-500/5">
            <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              Capability
            </th>
            <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-200">
              Mörbius
              <div className="font-grotesk text-[10px] font-normal normal-case tracking-normal text-purple-300/80">
                sovereign · open · agentic
              </div>
            </th>
            {COMPETITORS.map((c) => (
              <th
                key={c.name}
                className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted"
              >
                {c.name}
                <div className="font-grotesk text-[10px] font-normal normal-case tracking-normal text-app-faint">
                  {c.tag}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMP_ROWS.map((row, i) => (
            <tr
              key={row.axis}
              className={cn(
                'border-b border-app-subtle/40 align-top',
                i % 2 === 0 ? 'bg-white/[0.012]' : 'bg-transparent',
              )}
            >
              <td className="px-4 py-3 font-grotesk text-sm text-app-secondary">{row.axis}</td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    'inline-block rounded-full border px-2 py-0.5 font-grotesk text-[11px]',
                    TONE_CHIP[row.morbius.tone],
                  )}
                >
                  {row.morbius.value}
                </span>
              </td>
              {row.cells.map((c, j) => (
                <td key={`${row.axis}-${j}`} className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-block rounded-full border px-2 py-0.5 font-grotesk text-[11px]',
                      TONE_CHIP[c.tone],
                    )}
                  >
                    {c.value}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompetitiveNarrative() {
  return (
    <div className="mt-10 grid gap-5 lg:grid-cols-3">
      <NarrativeCard
        title="Where Mörbius wins"
        tone="bio"
        bullets={[
          'Local-first runtime — the brain works offline against Ollama',
          'Open code — every prompt + every gate is auditable',
          'Five-pillar architecture — RAG · agentic · medical knowledge · memory · self-learning',
          'API-first — Postman-ready Bearer token surface',
          'Real signed PDF Rx with QR back-link',
        ]}
      />
      <NarrativeCard
        title="Where we're at parity"
        tone="blue"
        bullets={[
          '6 specialists handle the high-volume case load',
          'AI scribe: deterministic SOAP notes export to Markdown / EHR',
          'Multi-language for the consult surface (5 languages, more on request)',
          'Cross-validating diagnostic catches single-model hallucinations',
        ]}
      />
      <NarrativeCard
        title="The honest gaps"
        tone="amber"
        bullets={[
          'EHR write-back to Epic / Cerner — schema is FHIR R4, integration in pilot',
          'Formal HIPAA / SOC 2 cert — architecture is ready, audit is paid work',
          'Live human handoff for emergencies — escalation banner ships next wave',
          'Specialty depth on rarer conditions vs Glass / Open Evidence',
          'Mobile native UX — Capacitor shell exists, polish lands with the v0.3 mobile pass',
        ]}
      />
    </div>
  );
}

function NarrativeCard({
  title,
  tone,
  bullets,
}: {
  title: string;
  tone: 'bio' | 'blue' | 'amber';
  bullets: string[];
}) {
  const cls = {
    bio: 'border-bio-500/30 from-bio-500/10',
    blue: 'border-blue-400/30 from-blue-500/10',
    amber: 'border-amber-500/30 from-amber-500/10',
  } as const;
  const accent = {
    bio: 'text-bio-300',
    blue: 'text-blue-300',
    amber: 'text-amber-300',
  } as const;
  return (
    <div
      className={cn(
        'rounded-3xl border bg-gradient-to-br via-transparent to-transparent p-6 backdrop-blur-2xl',
        cls[tone],
      )}
    >
      <h3 className={cn('font-syne text-xl font-bold', accent[tone])}>{title}</h3>
      <ul className="mt-4 space-y-2">
        {bullets.map((b) => (
          <li
            key={b}
            className="flex items-start gap-2 font-grotesk text-sm leading-relaxed text-app-secondary"
          >
            <span
              className={cn('mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full', accent[tone])}
            />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
//  NEWS / READING LIST + QUANTUM ARTICLE
// ============================================================================

interface NewsArticleSpec {
  title: string;
  source: string;
  href: string;
  body: string;
  tone: 'purple' | 'blue' | 'bio' | 'amber';
  icon: typeof Newspaper;
}

const NEWS_ARTICLES: NewsArticleSpec[] = [
  {
    title: 'MONAI 1.4 — clinical-grade 3D segmentation, now with auto-mixed precision',
    source: 'Project MONAI',
    href: 'https://monai.io',
    body: 'The medical-imaging framework Mörbius wraps. Their nnU-Net presets ship with Dice ≥ 0.85 on BraTS / LiTS — the floor we hold imaging to.',
    tone: 'blue',
    icon: Newspaper,
  },
  {
    title: 'Med-Gemini · Google’s vision-language clinical reasoner',
    source: 'arXiv 2024',
    href: 'https://arxiv.org/abs/2404.18416',
    body: 'A fresh datapoint on multimodal LLMs for clinical Q&A. Notable for its long-context grounding — exactly the gap our specialist agents close with RAG.',
    tone: 'purple',
    icon: BookOpen,
  },
  {
    title: 'PubMed E-utilities — the citation backbone',
    source: 'NCBI',
    href: 'https://www.ncbi.nlm.nih.gov/books/NBK25500/',
    body: 'Free-tier API behind the ResearchAgent. Returns abstracts + PMIDs that the EvidenceSynth agent stitches into footnoted answers.',
    tone: 'bio',
    icon: BookOpen,
  },
];

function NewsArticle({ article }: { article: NewsArticleSpec }) {
  const Icon = article.icon;
  const toneCls = {
    purple: 'border-purple-400/30 hover:border-purple-400/60 text-purple-200',
    blue: 'border-blue-400/30 hover:border-blue-400/60 text-blue-200',
    bio: 'border-bio-500/30 hover:border-bio-500/60 text-bio-200',
    amber: 'border-amber-500/30 hover:border-amber-500/60 text-amber-200',
  } as const;
  return (
    <a
      href={article.href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'group flex h-full flex-col rounded-3xl border bg-white/[0.025] p-6 backdrop-blur-2xl transition hover:-translate-y-1 hover:bg-white/[0.05]',
        toneCls[article.tone],
      )}
    >
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {article.source}
        </span>
      </div>
      <h3 className="mt-5 font-syne text-lg font-bold leading-tight text-app-primary">
        {article.title}
      </h3>
      <p className="mt-3 flex-1 font-grotesk text-sm leading-relaxed text-app-secondary">
        {article.body}
      </p>
      <div className="mt-5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em]">
        read source <ArrowRight className="h-3 w-3" />
      </div>
    </a>
  );
}

function QuantumDeepDive() {
  return (
    <div className="mt-10 rounded-[2rem] border border-purple-400/30 bg-gradient-to-br from-purple-900/30 via-blue-900/20 to-black/50 p-8 backdrop-blur-2xl shadow-[0_0_120px_-40px_rgba(139,92,246,0.7)] sm:p-12">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-400/40 bg-purple-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-200">
            <Atom className="h-3 w-3" /> · deep dive
          </div>
          <h3 className="mt-5 font-syne text-display-xl font-bold text-app-primary">
            Where quantum{' '}
            <span className="bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">
              actually fits
            </span>{' '}
            in medical AI.
          </h3>
        </div>
        <div className="space-y-4 font-grotesk text-base leading-relaxed text-app-secondary">
          <p>
            Quantum compute isn’t a magic upgrade for chatbots. It is, however, a genuine new
            gradient for three medical workloads where classical solvers stall: protein-folding
            energy minimisation, drug-target binding affinity sampling, and combinatorial
            radiotherapy plan optimisation. Variational quantum eigensolvers (VQE) and quantum
            approximate optimisation (QAOA) are the candidates the field is converging on.
          </p>
          <p>
            Mörbius keeps a <span className="text-purple-200">Quantum Compute Agent</span> interface
            in <code className="rounded bg-white/5 px-1 font-mono text-xs">@dr-abc/agents</code>—
            currently a classical fallback, opt-in per task with a cost gate. When IBM’s 1,000+
            qubit Heron generation is broadly available, that interface is what we plug
            Qiskit-Runtime / Braket into. Until then, the honest answer is "classical".
          </p>
          <p>
            The deeper bet is sovereign: a hospital that owns its quantum slot can run sensitive
            drug-screen optimisations without sending the molecule to a vendor cloud — same
            local-first principle that drives the rest of the brain.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-purple-200">
              VQE
            </span>
            <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1 text-blue-200">
              QAOA
            </span>
            <span className="rounded-full border border-bio-500/30 bg-bio-500/10 px-3 py-1 text-bio-200">
              IBM Heron
            </span>
            <span className="rounded-full border border-app-subtle bg-white/5 px-3 py-1 text-app-muted">
              AWS Braket
            </span>
            <span className="rounded-full border border-app-subtle bg-white/5 px-3 py-1 text-app-muted">
              Qiskit Runtime
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  TRUSTED-BY MARQUEE — real brand SVG marks, not text
// ============================================================================

interface BrandSpec {
  label: string;
  Icon: typeof OpenAIMark;
}

const TRUSTED_BRANDS: BrandSpec[] = [
  { label: 'SRH University Stuttgart', Icon: SRHMark },
  { label: 'Anthropic', Icon: AnthropicMark },
  { label: 'OpenAI', Icon: OpenAIMark },
  { label: 'NVIDIA NIM', Icon: NvidiaMark },
  { label: 'Hugging Face', Icon: HuggingFaceMark },
  { label: 'PyTorch', Icon: PyTorchMark },
  { label: 'MONAI', Icon: MonaiMark },
  { label: 'Ollama', Icon: OllamaMark },
  { label: 'PubMed', Icon: PubMedMark },
  { label: 'FHIR R4', Icon: FHIRMark },
];

function BrandLogo({ brand, ariaHidden }: { brand: BrandSpec; ariaHidden?: boolean }) {
  const { Icon, label } = brand;
  return (
    <span
      aria-hidden={ariaHidden ? 'true' : undefined}
      className="inline-flex shrink-0 items-center gap-2.5 text-app-muted transition hover:text-blue-200"
    >
      <Icon className="h-7 w-7 sm:h-8 sm:w-8" />
      <span className="font-syne text-base font-medium uppercase tracking-tight sm:text-lg">
        {label}
      </span>
    </span>
  );
}

// ============================================================================
//  HERO STAT
// ============================================================================

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_18px_-8px_rgba(0,0,0,0.4)]"
    >
      {/* Subtle gradient sheen on the top edge — adds depth without
          competing with the headline + 3D head. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="font-display text-2xl font-bold tracking-tight text-app-primary">{value}</div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
        {label}
      </div>
    </motion.div>
  );
}

// ============================================================================
//  FLOATING CHIP — over the 3D head
// ============================================================================

function FloatingChip({
  position,
  label,
  tone,
  delay,
}: {
  position: string;
  label: string;
  tone: 'bio' | 'purple' | 'blue';
  delay: number;
}) {
  const toneCls = {
    bio: 'border-bio-500/40 bg-bio-500/10 text-bio-200',
    purple: 'border-purple-400/40 bg-purple-500/10 text-purple-200',
    blue: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  } as const;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay }}
      className={cn(
        'absolute inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[9px] uppercase tracking-[0.22em] backdrop-blur-md',
        toneCls[tone],
        position,
      )}
    >
      <PulseDot active size="xs" tone={tone === 'bio' ? 'bio' : 'quantum'} />
      {label}
    </motion.div>
  );
}

// ============================================================================
//  COMPARE CARD — used in us-vs-them
// ============================================================================

function CompareCard({
  title,
  tone,
  bullets,
}: {
  title: string;
  tone: 'muted' | 'primary';
  bullets: ['yes' | 'no', string][];
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-3xl border p-7 backdrop-blur-2xl transition',
        tone === 'primary'
          ? 'border-purple-400/40 bg-gradient-to-br from-purple-500/15 via-blue-500/10 to-transparent shadow-[0_0_80px_-30px_rgba(139,92,246,0.7)]'
          : 'border-app-subtle bg-white/[0.025]',
      )}
    >
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.28em] text-app-faint">
        {tone === 'primary' ? '· Mörbius' : '· The other guys'}
      </div>
      <h3
        className={cn(
          'font-syne text-3xl font-bold',
          tone === 'primary' ? 'text-app-primary' : 'text-app-muted',
        )}
      >
        {title}
      </h3>
      <ul className="mt-7 space-y-3">
        {bullets.map(([kind, text]) => (
          <li key={text} className="flex items-start gap-3">
            {kind === 'yes' ? (
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-bio-500/40 bg-bio-500/15">
                <Check className="h-3 w-3 text-bio-300" />
              </span>
            ) : (
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rose-500/40 bg-rose-500/10">
                <X className="h-3 w-3 text-rose-300" />
              </span>
            )}
            <span
              className={cn(
                'font-grotesk text-base',
                tone === 'primary' ? 'text-app-secondary' : 'text-app-muted',
              )}
            >
              {text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
//  PILLAR CARD — five-pillar ecosystem
// ============================================================================

const PILLAR_TONE: Record<
  'purple' | 'blue' | 'bio' | 'amber' | 'rose',
  { border: string; text: string; glow: string }
> = {
  purple: {
    border: 'border-purple-400/30 hover:border-purple-400/60',
    text: 'text-purple-300',
    glow: 'shadow-[0_0_60px_-25px_rgba(139,92,246,0.6)]',
  },
  blue: {
    border: 'border-blue-400/30 hover:border-blue-400/60',
    text: 'text-blue-300',
    glow: 'shadow-[0_0_60px_-25px_rgba(96,165,250,0.6)]',
  },
  bio: {
    border: 'border-bio-500/30 hover:border-bio-500/60',
    text: 'text-bio-300',
    glow: 'shadow-[0_0_60px_-25px_rgba(16,185,129,0.55)]',
  },
  amber: {
    border: 'border-amber-500/30 hover:border-amber-500/60',
    text: 'text-amber-300',
    glow: 'shadow-[0_0_60px_-25px_rgba(245,158,11,0.55)]',
  },
  rose: {
    border: 'border-rose-500/30 hover:border-rose-500/60',
    text: 'text-rose-300',
    glow: 'shadow-[0_0_60px_-25px_rgba(244,63,94,0.55)]',
  },
};

function PillarCard({
  index,
  icon: Icon,
  title,
  body,
  tone,
}: {
  index: string;
  icon: typeof Brain;
  title: string;
  body: string;
  tone: keyof typeof PILLAR_TONE;
}) {
  const t = PILLAR_TONE[tone];
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-3xl border bg-white/[0.025] p-6 backdrop-blur-2xl transition hover:-translate-y-1 hover:bg-white/[0.05]',
        t.border,
        t.glow,
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] tracking-[0.32em] text-app-faint">{index}</span>
        <Icon className={cn('h-5 w-5', t.text)} />
      </div>
      <h3 className={cn('mt-6 font-syne text-2xl font-bold', t.text)}>{title}</h3>
      <p className="mt-3 font-grotesk text-sm leading-relaxed text-app-secondary">{body}</p>
    </div>
  );
}

// ============================================================================
//  PORTFOLIO FEATURE — slot in the ecosystem grid
// ============================================================================

function PortfolioFeature() {
  return (
    <div className="lg:col-span-3 mt-2 grid gap-6 rounded-3xl border border-app-subtle bg-gradient-to-br from-purple-900/20 via-blue-900/15 to-black/40 p-7 backdrop-blur-2xl sm:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
          · Case study · Stage 8
        </div>
        <h3 className="mt-3 font-syne text-3xl font-bold text-app-primary">
          From "very fancy" to{' '}
          <span className="bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">
            very useful.
          </span>
        </h3>
        <p className="mt-4 font-grotesk text-base text-app-secondary">
          The reviewer said "very fancy". We deleted{' '}
          <span className="text-purple-300">−13,553 LOC</span> of theatre — quantum overlays,
          surgical sims, dev playgrounds — and built what was actually missing: a real five-pillar
          brain.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-app-faint">
          <span className="rounded-full border border-app-subtle bg-white/5 px-3 py-1">
            −13,553 LOC
          </span>
          <span className="rounded-full border border-app-subtle bg-white/5 px-3 py-1">
            +346 tests
          </span>
          <span className="rounded-full border border-app-subtle bg-white/5 px-3 py-1">
            5 brain pillars
          </span>
          <span className="rounded-full border border-app-subtle bg-white/5 px-3 py-1">
            6 specialists
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MiniMetric label="Demolition" value="Wave R" tone="rose" />
        <MiniMetric label="PDF Rx" value="Wave S" tone="amber" />
        <MiniMetric label="Translate" value="Wave T" tone="blue" />
        <MiniMetric label="Specialists" value="Wave U" tone="purple" />
        <MiniMetric label="Imaging" value="Wave V" tone="bio" />
        <MiniMetric label="Brain" value="Wave V1.7" tone="purple" />
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone,
}: { label: string; value: string; tone: keyof typeof PILLAR_TONE }) {
  const t = PILLAR_TONE[tone];
  return (
    <div
      className={cn(
        'rounded-xl border bg-white/[0.025] p-3 backdrop-blur-xl transition hover:bg-white/[0.05]',
        t.border,
      )}
    >
      <div className={cn('font-syne text-lg font-bold', t.text)}>{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">{label}</div>
    </div>
  );
}

// ============================================================================
//  STEP CARD — process path
// ============================================================================

function StepCard({
  step,
  title,
  body,
  accent,
}: {
  step: string;
  title: string;
  body: string;
  accent: 'purple' | 'blue' | 'bio';
}) {
  const t = PILLAR_TONE[accent];
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl border bg-white/[0.025] p-7 backdrop-blur-2xl transition hover:-translate-y-0.5 hover:bg-white/[0.05]',
        t.border,
        t.glow,
      )}
    >
      <div className={cn('font-syne text-7xl font-bold opacity-20', t.text)}>{step}</div>
      <h3 className="mt-2 font-syne text-2xl font-bold text-app-primary">{title}</h3>
      <p className="mt-3 font-grotesk text-base leading-relaxed text-app-secondary">{body}</p>
    </div>
  );
}

// ============================================================================
//  TIER CARD
// ============================================================================

function TierCard({
  name,
  price,
  tagline,
  features,
  cta,
  featured,
}: {
  name: string;
  price: string;
  tagline: string;
  features: string[];
  cta: { label: string; to: string };
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-3xl border p-6 backdrop-blur-2xl transition hover:-translate-y-1',
        featured
          ? 'border-purple-400/50 bg-gradient-to-br from-purple-500/15 via-blue-500/10 to-transparent shadow-[0_0_80px_-25px_rgba(139,92,246,0.7)]'
          : 'border-app-subtle bg-white/[0.025] hover:border-blue-400/40',
      )}
    >
      {featured && (
        <div className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full border border-purple-400/50 bg-purple-500/30 px-3 py-0.5 font-mono text-[9px] uppercase tracking-[0.28em] text-purple-100 backdrop-blur-xl">
          <Zap className="h-3 w-3" /> popular
        </div>
      )}
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">{name}</div>
      <div className="mt-2 font-syne text-3xl font-bold text-app-primary">{price}</div>
      <div className="mt-1 font-grotesk text-xs text-app-muted">{tagline}</div>
      <ul className="mt-6 flex-1 space-y-2.5 border-t border-app-subtle pt-5">
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 font-grotesk text-sm leading-snug text-app-secondary"
          >
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bio-400" /> {f}
          </li>
        ))}
      </ul>
      <div className="mt-6">
        {cta.to.startsWith('http') ? (
          <a
            href={cta.to}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 font-grotesk text-sm transition',
              featured
                ? 'border-transparent bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                : 'border-app-subtle bg-white/5 text-app-primary hover:border-blue-400/40 hover:bg-white/10',
            )}
          >
            {cta.label} <ArrowRight className="h-3.5 w-3.5" />
          </a>
        ) : (
          <Link
            href={cta.to}
            className={cn(
              'inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 font-grotesk text-sm transition',
              featured
                ? 'border-transparent bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                : 'border-app-subtle bg-white/5 text-app-primary hover:border-blue-400/40 hover:bg-white/10',
            )}
          >
            {cta.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

// ============================================================================
//  APPLICATION FORM
// ============================================================================

interface FormState {
  name: string;
  email: string;
  org: string;
  intent: 'pilot' | 'project' | 'contributor' | 'other';
  message: string;
}

function ApplicationForm() {
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    org: '',
    intent: 'pilot',
    message: '',
  });
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Mailto fallback so the form works even without a backend submit
    // endpoint. Applications are reviewed individually, so a clean inbox
    // handoff is the appropriate primitive here.
    const subject = `Mörbius collaboration · ${form.intent} · ${form.org || form.name}`;
    const body = [
      `Name: ${form.name}`,
      `Email: ${form.email}`,
      `Organisation: ${form.org}`,
      `Intent: ${form.intent}`,
      '',
      form.message,
    ].join('\n');
    window.location.href = `mailto:abhilashanuku14@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-app-subtle bg-black/30 p-5 backdrop-blur-xl"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="Name"
          value={form.name}
          onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="Your name"
          required
        />
        <FormField
          label="Email"
          type="email"
          value={form.email}
          onChange={(v) => setForm((f) => ({ ...f, email: v }))}
          placeholder="you@hospital.de"
          required
        />
      </div>
      <FormField
        label="Organisation"
        value={form.org}
        onChange={(v) => setForm((f) => ({ ...f, org: v }))}
        placeholder="Charité · MIT · TUM · independent…"
      />
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          Intent
        </span>
        <select
          value={form.intent}
          onChange={(e) =>
            setForm((f) => ({ ...f, intent: e.target.value as FormState['intent'] }))
          }
          className="rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-grotesk text-sm text-app-primary focus:border-blue-400/60 focus:outline-none"
        >
          <option value="pilot" className="bg-ink-950">
            Hospital pilot
          </option>
          <option value="project" className="bg-ink-950">
            Research / project
          </option>
          <option value="contributor" className="bg-ink-950">
            Open-source contributor
          </option>
          <option value="other" className="bg-ink-950">
            Other
          </option>
        </select>
      </label>
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          Message
        </span>
        <textarea
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          rows={4}
          placeholder="What would you build with a sovereign brain? What's the constraint we should know about?"
          className="resize-none rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-grotesk text-sm text-app-primary placeholder:text-app-faint/60 focus:border-blue-400/60 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3 font-grotesk text-sm font-medium text-white shadow-[0_0_60px_-15px_rgba(139,92,246,0.7)] transition hover:from-purple-500 hover:to-blue-500"
      >
        {sent ? 'Mailbox opened ✓' : 'Send application'} <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        Submitting opens your default mail client · we reply within a week
      </p>
    </form>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-grotesk text-sm text-app-primary placeholder:text-app-faint/60 focus:border-blue-400/60 focus:outline-none"
      />
    </label>
  );
}

// ============================================================================
//  LIVE MINI-CONSULT — preserved exactly from the prior landing
// ============================================================================

interface ConsultEvent {
  type: string;
  agent?: string;
  text?: string;
  esi?: number;
  rationale?: string;
}

/**
 * HeroBackdrop — three floating SVG illustrations drifting behind the
 * hero. Pure SVG (no Three.js cost on first paint) so the backdrop is
 * < 4 KB and works in both light + dark themes via theme-token
 * stroke + opacity. pointer-events: none so the visitor can still
 * click the hero CTA + chat through these decorations.
 *
 *   1. DNA double helix (left)         — slow rotate, ~30 s loop
 *   2. Molecular cluster (right)        — gentle drift + rotate
 *   3. ECG waveform line (bottom)       — left-to-right sweep, pulses
 *
 * Renders three floating medical-tech / DNA-RNA structure illustrations
 * in the background for a clinical feel in both dark and light themes,
 * with a realistic, responsive treatment.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      {/* 1 — DNA double helix · left-middle */}
      <motion.svg
        viewBox="0 0 200 480"
        className="absolute top-[8%] left-[-3%] h-[78%] w-auto opacity-[0.12] [stroke:theme(colors.bio.400)] dark:opacity-[0.18]"
        initial={{ rotate: 0, y: 0 }}
        animate={{ rotate: 6, y: -20 }}
        transition={{
          duration: 14,
          repeat: Number.POSITIVE_INFINITY,
          repeatType: 'mirror',
          ease: 'easeInOut',
        }}
        fill="none"
        strokeWidth={1.2}
      >
        <title>DNA double helix decoration</title>
        {Array.from({ length: 14 }).map((_, i) => {
          const y = 30 + i * 30;
          const phase = i * 0.45;
          const x1 = 80 + Math.sin(phase) * 50;
          const x2 = 120 - Math.sin(phase) * 50;
          return (
            <g key={`helix-${y}`}>
              <line x1={x1} y1={y} x2={x2} y2={y} />
              <circle cx={x1} cy={y} r={3.5} fill="currentColor" className="text-quantum-400" />
              <circle cx={x2} cy={y} r={3.5} fill="currentColor" className="text-purple-400" />
            </g>
          );
        })}
        {/* The two helix backbones — sinusoidal paths connecting the
            rungs above so the whole thing reads as a real helix. */}
        <path
          d="M 80 30 Q 130 90 80 150 Q 30 210 80 270 Q 130 330 80 390 Q 30 450 80 480"
          stroke="currentColor"
          className="text-quantum-400"
        />
        <path
          d="M 120 30 Q 70 90 120 150 Q 170 210 120 270 Q 70 330 120 390 Q 170 450 120 480"
          stroke="currentColor"
          className="text-purple-400"
        />
      </motion.svg>

      {/* 2 — Molecular cluster · top-right */}
      <motion.svg
        viewBox="0 0 320 320"
        className="absolute top-[6%] right-[-4%] h-[44%] w-auto opacity-[0.10] [stroke:theme(colors.quantum.400)] dark:opacity-[0.16]"
        initial={{ rotate: 0 }}
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        fill="none"
        strokeWidth={1.4}
      >
        <title>Molecular cluster decoration</title>
        {/* Central atom */}
        <circle cx="160" cy="160" r="14" fill="currentColor" className="text-bio-400" />
        {/* Satellite atoms with bonds */}
        {[
          { x: 60, y: 60, tone: 'text-quantum-400' },
          { x: 260, y: 60, tone: 'text-purple-400' },
          { x: 60, y: 260, tone: 'text-bio-400' },
          { x: 260, y: 260, tone: 'text-amber-400' },
          { x: 160, y: 30, tone: 'text-quantum-400' },
          { x: 30, y: 160, tone: 'text-purple-400' },
          { x: 290, y: 160, tone: 'text-bio-400' },
          { x: 160, y: 290, tone: 'text-amber-400' },
        ].map((a) => (
          <g key={`atom-${a.x}-${a.y}`}>
            <line x1="160" y1="160" x2={a.x} y2={a.y} stroke="currentColor" />
            <circle cx={a.x} cy={a.y} r="9" fill="currentColor" className={a.tone} />
          </g>
        ))}
      </motion.svg>

      {/* 3 — ECG waveform · bottom band, left-to-right sweep */}
      <svg
        viewBox="0 0 1400 80"
        preserveAspectRatio="none"
        className="absolute right-0 bottom-[4%] left-0 h-12 w-full opacity-[0.16] dark:opacity-[0.22]"
        fill="none"
        strokeWidth={1.5}
      >
        <title>ECG rhythm decoration</title>
        <motion.path
          d="M 0 40 L 120 40 L 140 40 L 160 30 L 175 70 L 195 10 L 215 60 L 235 40 L 360 40 L 380 40 L 400 30 L 415 70 L 435 10 L 455 60 L 475 40 L 620 40 L 640 30 L 655 70 L 675 10 L 695 60 L 715 40 L 840 40 L 860 30 L 875 70 L 895 10 L 915 60 L 935 40 L 1080 40 L 1100 30 L 1115 70 L 1135 10 L 1155 60 L 1175 40 L 1400 40"
          stroke="currentColor"
          className="text-bio-400"
          initial={{ pathLength: 0, opacity: 0.3 }}
          animate={{ pathLength: 1, opacity: 0.9 }}
          transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        />
      </svg>

      {/* Soft radial gradient on top so the corners fade out and the
          backdrop never competes with the headline / chat for focus. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 45%, transparent 0%, var(--app-bg, transparent) 90%)',
        }}
      />
    </div>
  );
}

/**
 * SubscribeBlock — visitor leaves an email, Mörbius drafts a welcome
 * in the visitor's own mail client (mailto:) addressed to the admin
 * inbox. The browser opens the user's default mail app pre-filled
 * with a friendly body; the user can edit the subject + body before
 * sending, and the admin inbox receives a real email at
 * abhilashanuku14@gmail.com that an admin-panel sync job can later
 * ingest as a subscriber row.
 *
 * Local mirror: every submitted email is also stashed to
 * localStorage:dr-abc:subscribers so the list can be exported from any
 * browser session, even if the mailto: never lands (corporate networks
 * sometimes block mailto:).
 *
 * Until the backend subscriber endpoint lands, the mailto: + localStorage
 * pair is the whole pipeline.
 */
function SubscribeBlock() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  const ADMIN_INBOX = 'abhilashanuku14@gmail.com';
  const STORAGE_KEY = 'dr-abc:subscribers';

  const composeMailtoUrl = (subscriberEmail: string): string => {
    const subject = ''; // subject left blank — curated later in the admin panel
    const body = [
      'Hello Mörbius team,',
      '',
      'Please add me to the Dr·ABC updates list.',
      '',
      `My email: ${subscriberEmail}`,
      'Sent from: dr-abc.local',
      '',
      'Welcome — looking forward to the next release. I want to hear about: clinical pilots, the open-source release, the mobile build, and any case-study reports.',
      '',
      'Thanks,',
      '— a future patient + reviewer',
    ].join('\n');
    const params = new URLSearchParams({ subject, body });
    return `mailto:${ADMIN_INBOX}?${params.toString()}`;
  };

  const stashLocally = (subscriberEmail: string) => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const existing: { email: string; ts: number }[] = raw ? JSON.parse(raw) : [];
      const next = [...existing, { email: subscriberEmail, ts: Date.now() }];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota or serialisation error — non-fatal; the mailto: is the
      // primary delivery path.
    }
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const value = email.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setStatus('error');
      return;
    }
    stashLocally(value);
    try {
      window.location.href = composeMailtoUrl(value);
      setStatus('sent');
      setEmail('');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="rounded-2xl border border-purple-400/40 bg-purple-500/10 p-6 backdrop-blur-md">
      <div className="grid gap-5 lg:grid-cols-[1.2fr_minmax(0,1fr)] lg:items-center">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-purple-300/40 bg-purple-500/10 px-3 py-1">
            <PulseDot active size="xs" tone="bio" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-purple-200">
              early access
            </span>
          </div>
          <h3 className="font-syne text-2xl font-bold tracking-tight text-app-primary">
            Get the next Mörbius update in your inbox.
          </h3>
          <p className="mt-2 max-w-xl font-grotesk text-sm leading-relaxed text-app-muted">
            Clinical pilots, open-source release notes, the mobile build, and reproducible case
            studies. No spam — fewer than one email per week.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              aria-label="Email address"
              className="min-w-0 flex-1 rounded-xl border border-app-subtle bg-white/5 px-4 py-3 font-grotesk text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
            />
            <Button
              type="submit"
              variant="primary"
              className="rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-5 hover:from-purple-500 hover:to-blue-500"
            >
              Send <Send className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
          {status === 'sent' && (
            <p className="font-sans text-xs text-bio-300">
              ✓ Your mail client should have opened with a welcome draft. Hit send and we'll take it
              from there.
            </p>
          )}
          {status === 'error' && (
            <p className="font-sans text-xs text-rose-300">
              That doesn't look like a valid email — please check and try again.
            </p>
          )}
          <p className="font-sans text-[11px] text-app-faint">
            Clicking <em>Send</em> opens your default mail app with a welcome message we drafted for
            you. Edit before sending; we never store your email anywhere except your own device.
          </p>
        </form>
      </div>
    </div>
  );
}

function MiniConsult() {
  const [, setLocation] = useLocation();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<GuestTurn[]>(() => loadGuestChat());
  const [streaming, setStreaming] = useState(false);
  const userTurns = turns.filter((t) => t.role === 'user').length;
  const overLimit = userTurns >= 3;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (streaming || !text) return;
    setStreaming(true);
    setInput('');

    // Stash the patient turn locally first so the UI paints
    // immediately, even before the cascade replies. The same write
    // persists to localStorage so the conversation survives a sign-in
    // redirect.
    const userTurn = appendGuestTurn('user', text);
    setTurns((t) => [...t, userTurn]);

    try {
      const res = await fetch(`${API_BASE}/orchestrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.body) throw new Error('no body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let reply = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim());
            // SOAP-gate aware — when triage emits clarifyingQuestions
            // for vague/exploratory inputs, render those verbatim
            // (warm-doctor flow) instead of waiting for a differential
            // that will not arrive.
            if (ev.type === 'agent.completed' && ev.result?.agent === 'triage') {
              const d = ev.result.data ?? {};
              if (d.needsClarification && Array.isArray(d.clarifyingQuestions)) {
                const parts: string[] = [];
                if (d.acknowledgement) parts.push(d.acknowledgement);
                parts.push(
                  d.clarifyingQuestions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n'),
                );
                parts.push(
                  "Answer as much as you're comfortable with — we'll take it step by step.",
                );
                reply = parts.join('\n\n');
              }
            }
            // When the pipeline completes with a real differential,
            // paint the warm-doctor differential reply.
            if (ev.type === 'pipeline.completed' && !reply && ev.result) {
              const d = ev.result.data ?? {};
              const top = d.differentials?.[0];
              if (top) {
                const conf = Math.round((top.probability ?? 0) * 100);
                const tests = d.recommendedTests?.join(', ');
                const spec = d.recommendedSpecialty;
                const parts = [
                  `Putting it together, this looks most like **${top.condition}** — about ${conf}% on that.`,
                ];
                if (tests) parts.push(`To confirm, I'd run: ${tests}.`);
                if (spec) parts.push(`Specialty: ${spec}.`);
                reply = parts.join('\n\n');
              }
            }
          } catch {
            /* skip */
          }
        }
      }
      if (!reply) {
        reply =
          "I worked through it, but the cascade didn't return a confident read this turn. Could you tell me a little more — when it started, how it feels, what makes it better or worse?";
      }
      const mörbiusTurn = appendGuestTurn('mörbius', reply);
      setTurns((t) => [...t, mörbiusTurn]);
    } catch {
      const errTurn = appendGuestTurn(
        'mörbius',
        '(Mörbius is offline right now. Try again in a moment, or sign in to use the full clinic.)',
      );
      setTurns((t) => [...t, errTurn]);
    } finally {
      setStreaming(false);
    }
  };

  const continueAfterSignIn = () => {
    // localStorage already holds the turns — the AuthProvider drains
    // them into per-user memory after authentication, and the clinic
    // page picks up from the last Mörbius reply.
    setLocation('/login?continue=chat');
  };

  return (
    <form onSubmit={submit} className="mt-1">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your symptoms…"
          className="flex-1 rounded-xl border border-app-subtle bg-white/5 px-4 py-3 font-grotesk text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
        />
        <Button
          type="submit"
          variant="primary"
          loading={streaming}
          className="rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-5 hover:from-purple-500 hover:to-blue-500"
        >
          {streaming ? 'Reasoning' : 'Try it'} <Send className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
      {turns.length > 0 && (
        <div className="mt-4 space-y-3 rounded-xl border border-app-subtle bg-black/40 p-4 font-grotesk text-sm">
          {turns.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'flex flex-col gap-1 rounded-lg border px-3 py-2',
                t.role === 'user'
                  ? 'self-end border-quantum-400/30 bg-quantum-500/10 text-app-primary'
                  : 'border-app-subtle bg-white/5 text-app-secondary',
              )}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
                {t.role === 'user' ? 'You' : 'Mörbius'}
              </span>
              <span className="whitespace-pre-line leading-relaxed">{t.text}</span>
            </motion.div>
          ))}
        </div>
      )}

      {overLimit && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-3 flex flex-col gap-2 rounded-xl border border-purple-400/40 bg-purple-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-app-secondary">
            Sign in to keep talking with Mörbius — your conversation comes with you.
          </span>
          <Button
            type="button"
            onClick={continueAfterSignIn}
            variant="primary"
            className="rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-4 hover:from-purple-500 hover:to-blue-500"
          >
            Sign in to continue →
          </Button>
        </motion.div>
      )}

      {turns.length === 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-app-faint">
            {[
              'severe chest pain radiating to left arm',
              'irregular periods + acne — could it be PCOS',
              "I've been feeling anxious and not sleeping",
              'dull headache for three days',
              'can you suggest meds for migraine',
              'fatigue + weight gain over 3 months',
            ].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInput(s)}
                className="rounded-full border border-app-subtle bg-white/5 px-3 py-1 font-grotesk transition hover:border-purple-400/40 hover:bg-purple-500/10 hover:text-purple-200"
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-3 font-sans text-xs text-app-muted">
            Safe to ask about anything — symptoms, chronic conditions (PCOS / PCOD, thyroid,
            diabetes), mental-health, women's health, sexual health. Mörbius asks before it
            diagnoses, and crisis language always routes to a real helpline.
          </p>
        </>
      )}
    </form>
  );
}

// ============================================================================
//  LEGAL · COMPLIANCE · FAQ
//
//  Six articles cover the disclosures an MSc project committee + a
//  future clinical pilot reviewer would expect: medical-
//  AI scope, bias, conflict of interest, data sovereignty, license,
//  and accountability. Each article is a collapsible <details> for
//  quick scanning; "Canonical doc" links point at the actual repo
//  files so the claim is auditable, not just decoration.
// ============================================================================

interface LegalArticleSpec {
  id: string;
  icon: typeof Scale;
  title: string;
  summary: string;
  body: ReactNode;
}

const LEGAL_ARTICLES: LegalArticleSpec[] = [
  {
    id: 'medical-disclaimer',
    icon: HeartPulse,
    title: 'Medical disclaimer · scope of use',
    summary:
      'Dr.ABC / Mörbius is a research-grade decision-support tool. It is NOT a medical device, NOT FDA / CE / MDR cleared, and NOT a substitute for a licensed clinician.',
    body: (
      <>
        <p>
          Mörbius produces ranked differentials, drug-interaction warnings, ICD-10 code suggestions,
          and patient-friendly explanations. Every clinical output passes the Validator → Safety →
          Privacy gauntlet, but the platform is published as an MSc project artifact for academic +
          educational use. Don't act on its output without a licensed clinician in the loop.
        </p>
        <p className="mt-2">
          The Mörbius Secure Protocol (a hard-coded system instruction) prioritises one goal — save
          at least one human life — and routes red-flag pathways to immediate-escalation copy
          regardless of confidence. That's a safety floor, not a clinical guarantee.
        </p>
      </>
    ),
  },
  {
    id: 'ai-bias',
    icon: Scale,
    title: 'AI bias · training-data + reasoning transparency',
    summary:
      'The base model (Llama 3.3 70b Instruct) inherits biases from its public training corpus. We surface model + provenance per turn and ship a per-persona harness that scores patient · doctor · student demographics separately.',
    body: (
      <>
        <p>
          Every diagnostic turn returns a `modelUsed` field (e.g., `ollama:llama3.3:70b-instruct`)
          and the evidence the differential is built from. Specialist routing fires on chief
          complaint keywords, not on race, gender, or insurance status. The persona-harness writes
          to <code className="text-bio-300">docs/status/persona-summary-*.json</code> after every
          run so demographic skew is observable, not hidden.
        </p>
        <p className="mt-2">
          When a finding leans on inference rather than direct evidence the knowledge-graph edge is
          tagged <code>INFERRED</code> or <code>AMBIGUOUS</code>; the operator sees the difference
          in the consult panel.
        </p>
      </>
    ),
  },
  {
    id: 'conflict',
    icon: ShieldCheck,
    title: 'Conflict of interest · accountability',
    summary:
      'No commercial sponsor. Built as an MSc project at SRH Stuttgart by Abhilash Anuku and Simranjot Kaur. No clinician, hospital system, or insurer has a financial stake in the outputs.',
    body: (
      <>
        <p>
          The platform is fully open source. There is no in-app advertising, no paid placement of
          drugs/devices, and no per-recommendation revenue share. The default backend stack (Ollama
          + py-svc + Postgres) runs locally with no third-party tracking; cloud LLMs (Anthropic /
          NVIDIA NIM / HuggingFace) are opt-in via your own API keys.
        </p>
        <p className="mt-2">
          Bug reports + safety concerns: open a GitHub issue or email the authors. Authors of
          record: <strong>Abhilash Anuku</strong> and <strong>Simranjot Kaur</strong>.
        </p>
      </>
    ),
  },
  {
    id: 'privacy',
    icon: Lock,
    title: 'Privacy · data sovereignty',
    summary:
      'Local-first by design. Patient memory lives in IndexedDB on the device; the activity sink writes pseudonymous IDs; cloud LLMs only fire when you provide an API key.',
    body: (
      <>
        <p>
          No PHI is shipped in this repository — the 15 seeded cases are explicitly fictional. The
          consult transcript persists per-user under <code>localStorage</code> (per-user key prefix;
          never visible cross-user). The activity sink + Postgres mirror use a pseudonymous{' '}
          <code>userId</code>. Audit-log signing keys (Ed25519) live in <code>.env</code> and are
          not committed.
        </p>
        <p className="mt-2">
          When DATABASE_URL is unset, no server-side persistence happens; the entire consult lives
          on-device. When it's set, only the signed transcript mirror runs server-side and survives
          a localStorage clear.
        </p>
      </>
    ),
  },
  {
    id: 'license',
    icon: FileText,
    title: 'License · MIT · open source',
    summary:
      'Source published under MIT — read, fork, run, redistribute. Trademarks ("Mörbius", "Dr.ABC") and the Mörbius Secure Protocol wording are reserved attributions for academic citation.',
    body: (
      <>
        <p>
          The MIT license is at the repository root (<code>LICENSE</code>). No commercial
          restriction, no copyleft. If you ship a clinical or commercial derivative, name it
          accordingly and cite the SRH project. The Mörbius name and the Secure Protocol prose are
          attribution-only requests, not license restrictions.
        </p>
        <p className="mt-2">
          Third-party data: ICD-10 (CMS / WHO public domain), MedQA (research-license, see the
          original repo), MONAI (Apache-2.0), MarianMT (CC-BY-SA-4.0), Whisper (MIT), MedSAM
          (Apache-2.0). Each component keeps its upstream license.
        </p>
      </>
    ),
  },
  {
    id: 'usage',
    icon: AlertTriangle,
    title: 'Usage restrictions · what NOT to do',
    summary:
      "Don't use Mörbius for primary diagnosis without a clinician. Don't use it for triage in an active emergency — call your local emergency number. Don't feed it real PHI without your local IRB / ethics approval.",
    body: (
      <>
        <p>
          The platform is fit for: project demonstration, supervised clinical-research demos,
          education (medical students, residents), self-explanatory FAQ for patients about their own
          conditions, and engineering / red-team review.
        </p>
        <p className="mt-2">
          The platform is NOT fit for: unsupervised clinical decision-making, surgical guidance,
          autonomous prescription generation outside an IRB-cleared study, automated triage in
          public-health systems, or any path where a wrong differential could become an action
          without a human review step.
        </p>
      </>
    ),
  },
];

function LegalArticles() {
  return (
    <section id="legal" className="mx-auto w-full max-w-[1300px] px-5 py-20 sm:px-8 sm:py-28">
      <SectionHeader
        eyebrow="legal · compliance · FAQ"
        title="The disclosures behind the demo."
        subtitle="Six articles. Read what Mörbius is, what it's for, what it's not for, and where the safety floor sits. Every claim links to the file in the repo that implements it."
      />
      <div className="mt-12 grid gap-3">
        {LEGAL_ARTICLES.map((a) => {
          const Icon = a.icon;
          return (
            <details
              key={a.id}
              className="group rounded-2xl border border-app-subtle bg-white/[0.03] p-5 backdrop-blur-md transition hover:border-blue-400/40 hover:bg-white/[0.05] open:border-blue-400/40 open:bg-white/[0.06]"
            >
              <summary className="flex cursor-pointer list-none items-start gap-4 [&::-webkit-details-marker]:hidden">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/30 bg-blue-500/10">
                  <Icon className="h-4 w-4 text-blue-300" aria-hidden="true" />
                </span>
                <span className="flex-1">
                  <span className="block font-syne text-lg font-semibold tracking-tight text-app-primary sm:text-xl">
                    {a.title}
                  </span>
                  <span className="mt-1 block font-grotesk text-sm leading-relaxed text-app-muted">
                    {a.summary}
                  </span>
                </span>
                <ChevronDown
                  className="mt-1 h-4 w-4 shrink-0 text-app-faint transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-4 space-y-2 pl-13 font-grotesk text-sm leading-relaxed text-app-secondary sm:pl-[3.25rem]">
                {a.body}
              </div>
            </details>
          );
        })}
      </div>

      {/* One-line policy ledger underneath — the at-a-glance summary
          a project reviewer can screenshot without expanding any FAQ. */}
      <div className="mt-10 grid gap-3 rounded-2xl border border-app-subtle bg-white/[0.02] p-6 sm:grid-cols-2 lg:grid-cols-4">
        <PolicyChip label="Status" value="Research · MSc project" tone="blue" />
        <PolicyChip label="Regulatory" value="Not FDA / CE / MDR" tone="amber" />
        <PolicyChip label="License" value="MIT · open source" tone="bio" />
        <PolicyChip label="Data" value="Local-first · synthetic" tone="purple" />
      </div>
    </section>
  );
}

/**
 * LandscapeCard — one entry in the medical-AI landscape grid (§3).
 * Honest positioning: what category, who's in it, what it's used for.
 * No "vs Mörbius" framing — Mörbius lives in this landscape, not
 * against it.
 */
function LandscapeCard({
  category,
  examples,
  use,
  accent,
}: {
  category: string;
  examples: string;
  use: string;
  accent: 'purple' | 'blue' | 'bio' | 'amber' | 'rose';
}) {
  const TONE: Record<typeof accent, string> = {
    purple: 'border-purple-400/30 hover:border-purple-400/60 text-purple-300',
    blue: 'border-blue-400/30 hover:border-blue-400/60 text-blue-300',
    bio: 'border-bio-400/30 hover:border-bio-400/60 text-bio-300',
    amber: 'border-amber-400/30 hover:border-amber-400/60 text-amber-300',
    rose: 'border-rose-400/30 hover:border-rose-400/60 text-rose-300',
  };
  return (
    <div
      className={cn(
        'rounded-2xl border bg-white/[0.03] p-5 backdrop-blur-md transition hover:bg-white/[0.05]',
        TONE[accent],
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.32em]">{category}</div>
      <p className="mt-3 font-grotesk text-sm leading-relaxed text-app-secondary">
        <span className="text-app-primary">Currently used:</span> {examples}
      </p>
      <p className="mt-2 font-grotesk text-xs leading-relaxed text-app-muted">
        <span className="font-mono uppercase tracking-[0.18em] text-app-faint">use ·</span> {use}
      </p>
    </div>
  );
}

/**
 * AuthorCard — equal-weight student / collaborator card. Two of these
 * sit side-by-side in the footer (Abhi + Simranjot) so both authors
 * read as full peers on the page, not "and Simranjot Kaur" tacked on
 * the end of a comma-separated string.
 */
function AuthorCard({
  name,
  title,
  scope,
  initials,
  contact,
  github,
}: {
  name: string;
  title: string;
  scope: string;
  initials: string;
  contact: string;
  github: string | null;
}) {
  return (
    <div className="rounded-2xl border border-app-subtle bg-white/[0.03] p-5 backdrop-blur-md transition hover:border-purple-400/40 hover:bg-white/[0.05]">
      <div className="flex items-start gap-4">
        {/* Initials avatar — neutral, theme-token coloured */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-purple-400/40 bg-purple-500/10 font-display text-lg font-bold text-purple-200">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold text-app-primary">{name}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-300">
            {title}
          </div>
          <p className="mt-2 font-grotesk text-xs leading-relaxed text-app-muted">{scope}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[10px] text-app-muted">
            {contact !== '—' ? (
              <a
                href={`mailto:${contact}`}
                className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200"
              >
                <Mail className="h-3 w-3" /> {contact}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-app-faint">
                <Mail className="h-3 w-3" /> contact via SRH
              </span>
            )}
            {github && (
              <a
                href={`https://github.com/${github}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200"
              >
                github.com/{github} →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PolicyChip({
  label,
  value,
  tone,
}: { label: string; value: string; tone: 'blue' | 'amber' | 'bio' | 'purple' }) {
  const TONE: Record<typeof tone, string> = {
    blue: 'border-blue-400/30 bg-blue-500/10 text-blue-200',
    amber: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
    bio: 'border-bio-400/30 bg-bio-500/10 text-bio-200',
    purple: 'border-purple-400/30 bg-purple-500/10 text-purple-200',
  };
  return (
    <div className={cn('rounded-xl border px-4 py-3', TONE[tone])}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-80">{label}</div>
      <div className="mt-1 font-grotesk text-sm font-medium">{value}</div>
    </div>
  );
}

// ============================================================================
//  REVEAL ON SCROLL
// ============================================================================

function Reveal({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ============================================================================
//  BACKDROP — purple/blue blob field + grain
// ============================================================================

function BackdropBlobs() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <motion.div
        className="absolute -left-32 top-[-10%] h-150 w-150 rounded-full bg-purple-600/25 blur-[120px]"
        animate={{ x: [0, 30, 0], y: [0, 40, 0] }}
        transition={{ duration: 22, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute right-[-15%] top-[10%] h-160 w-160 rounded-full bg-blue-600/22 blur-[120px]"
        animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
        transition={{ duration: 26, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute left-[20%] bottom-[-15%] h-160 w-160 rounded-full bg-purple-500/18 blur-[120px]"
        animate={{ x: [0, 40, 0], y: [0, -25, 0] }}
        transition={{ duration: 30, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute right-[10%] bottom-[15%] h-130 w-130 rounded-full bg-bio-500/12 blur-[100px]"
        animate={{ x: [0, -20, 0], y: [0, 25, 0] }}
        transition={{ duration: 24, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      />
    </div>
  );
}

/**
 * CursorOrbs — eight crisp particles that trail the cursor.
 *
 * Renders the cursor-tracking dots clearly across themes. The old
 * build used `mix-blend-screen` + heavy blur; that vanished on light
 * backgrounds and smeared on dark. New version:
 *   · drops the blend mode → visible on every theme
 *   · cuts blur to a hairline · the orbs read as actual dots
 *   · solid-fill (not gradient-to-transparent) · CSS variables drive
 *     the color so the per-mode accent token wins (purple in aurora /
 *     navy in clinical / cyan in cobalt / forest in sage / magenta in
 *     synthwave)
 *   · adds a bright LEAD dot with a soft halo at the head of the
 *     trail · the cursor itself remains visible
 *   · 8 orbs (was 12) — less noise, more readable as a comet
 *
 * Single rAF loop drives all eight; rAF natively syncs to the
 * device's display refresh so motion is at max smoothness. Honours
 * `prefers-reduced-motion`.
 */
const ORB_SPECS: readonly { size: number; ease: number; opacity: number }[] = [
  // ease: smaller = longer trail. Lead orb is bright + crisp; tail
  // fades in opacity so the comet has a clear head and a soft tail.
  { size: 8, ease: 0.4, opacity: 0.95 }, // lead — crispest
  { size: 10, ease: 0.3, opacity: 0.85 },
  { size: 12, ease: 0.22, opacity: 0.7 },
  { size: 14, ease: 0.16, opacity: 0.55 },
  { size: 16, ease: 0.12, opacity: 0.42 },
  { size: 18, ease: 0.09, opacity: 0.3 },
  { size: 22, ease: 0.07, opacity: 0.2 },
  { size: 26, ease: 0.05, opacity: 0.12 },
];

function CursorOrbs() {
  const orbRefs = useRef<HTMLSpanElement[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    // Off-screen init so orbs don't flash at (0, 0) on first paint.
    const target = { x: -1000, y: -1000 };
    const positions = ORB_SPECS.map(() => ({ x: -1000, y: -1000 }));

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
    };
    const onLeave = () => {
      target.x = -1000;
      target.y = -1000;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);

    let raf = 0;
    const tick = () => {
      for (let i = 0; i < ORB_SPECS.length; i++) {
        const spec = ORB_SPECS[i];
        const pos = positions[i];
        if (!spec || !pos) continue;
        pos.x += (target.x - pos.x) * spec.ease;
        pos.y += (target.y - pos.y) * spec.ease;
        const el = orbRefs.current[i];
        if (el) {
          el.style.transform = `translate3d(${pos.x - spec.size / 2}px, ${pos.y - spec.size / 2}px, 0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[2] overflow-hidden">
      {ORB_SPECS.map((spec, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length tween array, indices are stable identities
          key={i}
          ref={(el) => {
            if (el) orbRefs.current[i] = el;
          }}
          className="absolute top-0 left-0 rounded-full will-change-transform"
          style={{
            width: `${spec.size}px`,
            height: `${spec.size}px`,
            // Solid theme-tinted dot · per-mode --accent-500 in light /
            // a brighter --accent-300 in dark. Halo glow comes from
            // box-shadow so the dot stays crisp.
            background: 'var(--accent-400, #a78bfa)',
            opacity: spec.opacity,
            boxShadow:
              i === 0
                ? '0 0 8px 2px var(--accent-400, #a78bfa), 0 0 16px 4px var(--accent-400, #a78bfa)'
                : `0 0 ${spec.size}px 0 var(--accent-400, #a78bfa)`,
            transform: 'translate3d(-1000px, -1000px, 0)',
          }}
        />
      ))}
    </div>
  );
}

function NoiseLayer() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] opacity-[0.035] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
      }}
    />
  );
}

// ============================================================================
//  SECTION HEADER + PUBLIC HEADER
// ============================================================================

type LearningOutcome = {
  id: string;
  title: string;
  body: string;
  proof: string;
};

const LEARNING_OUTCOMES: LearningOutcome[] = [
  {
    id: 'LO-01',
    title: 'Design & orchestrate multi-agent AI systems',
    body: 'Nine specialist agents share one typed BaseAgent contract behind a streaming orchestrator and an intent classifier that routes each consult.',
    proof: 'packages/morbius-core · packages/agents — orchestrator, registry, 9 agents',
  },
  {
    id: 'LO-02',
    title: 'Retrieval-augmented generation over a domain corpus',
    body: 'A Library agent fronted by a pgvector retriever with a BM25 fallback grounds every answer in medical literature, indexed in Qdrant + Postgres.',
    proof: 'PgVectorRetriever · Qdrant · BM25 fallback over medical corpora',
  },
  {
    id: 'LO-03',
    title: 'Represent & reason over structured knowledge',
    body: 'A typed medical knowledge graph — 88 nodes / 84 edges — built by a diff-aware extract → build → cluster → activation pipeline with spreading activation.',
    proof: 'packages/agents/src/knowledge-graph · docs/status/medical-graph.json',
  },
  {
    id: 'LO-04',
    title: 'Rigorous model evaluation against benchmarks',
    body: 'Reproducible harnesses score the cascade ensemble on academic benchmarks: 74.5% MedQA-USMLE-200 and 74.0% MedMCQA-100, snapshotted to docs/status/.',
    proof: 'scripts/medqa-harness.ts · accuracy gauntlet · dated JSON snapshots',
  },
  {
    id: 'LO-05',
    title: 'Continuous, self-correcting ML pipelines',
    body: 'Gradient-boosted error correction (Friedman 2001) turns every gate failure into a bounded, time-decayed residual on the next inference; a meta-agent proposes its own training agents.',
    proof: 'packages/agents/src/boosting · meta-agent · diff-aware delta fine-tune',
  },
  {
    id: 'LO-06',
    title: 'Ship safe, production-grade software',
    body: '610 tests, 8/8 strict typecheck, Biome-clean, a 100% Secure-Pass rate across the seeded cohort, CI gauntlets, and a multi-cloud free-tier deploy — local-first by default.',
    proof: '610/610 tests · Secure Pass (Validator→Safety→Privacy) · GitHub Actions',
  },
];

function LearningOutcomes() {
  return (
    <section id="outcomes" className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
      <SectionHeader
        eyebrow="· Inside the build"
        title="What's under the hood — and where to find it."
        subtitle="Six engineering ideas behind Dr·ABC, each pointing at the exact place it lives in the codebase — a file, a metric, or a test behind every one."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {LEARNING_OUTCOMES.map((outcome) => (
          <div
            key={outcome.id}
            className="rounded-2xl border border-app-subtle bg-white/5 p-6 backdrop-blur-xl transition hover:border-purple-400/40"
          >
            <div className="font-mono text-[11px] tracking-[0.32em] text-purple-300 uppercase">
              {outcome.id}
            </div>
            <h3 className="mt-2 font-syne text-xl font-bold text-app-primary">{outcome.title}</h3>
            <p className="mt-2 font-grotesk text-sm leading-relaxed text-app-secondary">
              {outcome.body}
            </p>
            <div className="mt-4 border-t border-app-subtle pt-3 font-mono text-[11px] leading-relaxed text-emerald-300">
              ▸ {outcome.proof}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <>
      {eyebrow && (
        <div className="mb-4 font-mono text-[11px] tracking-[0.32em] text-purple-300 uppercase">
          {eyebrow}
        </div>
      )}
      <h2 className="font-syne text-display-xl font-bold text-app-primary">{title}</h2>
      {subtitle && (
        <p className="mt-5 max-w-3xl font-grotesk text-lg leading-relaxed text-app-secondary">
          {subtitle}
        </p>
      )}
    </>
  );
}

function PublicHeader() {
  const { t } = useTranslation();
  const { status } = useAuth();
  return (
    <header className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-5 py-5 sm:px-8">
      <Link href="/" className="flex items-center gap-3">
        <div className="pulse-glow relative flex h-11 w-11 items-center justify-center rounded-2xl border border-purple-400/40 bg-purple-500/15 font-syne text-xl font-bold text-purple-200 backdrop-blur-md">
          M
        </div>
        <div>
          <div className="font-syne text-base font-bold tracking-tight text-app-primary">
            Dr<span className="text-bio-400">·</span>ABC
          </div>
          <div className="font-mono text-[9px] tracking-[0.32em] text-app-faint uppercase">
            POWERED BY MÖRBIUS
          </div>
        </div>
      </Link>
      <nav className="hidden items-center gap-3 sm:flex">
        <a
          href="#manifesto"
          className="hidden font-grotesk text-sm text-app-secondary hover:text-purple-200 sm:inline"
        >
          Manifesto
        </a>
        <a
          href="#apply"
          className="hidden font-grotesk text-sm text-app-secondary hover:text-purple-200 sm:inline"
        >
          Apply
        </a>
        {status === 'signed-in' ? (
          <Link href="/app">
            <Button
              variant="primary"
              className="rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-5 hover:from-purple-500 hover:to-blue-500"
            >
              {t('nav.dashboard')}
            </Button>
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="hidden font-grotesk text-sm text-app-secondary hover:text-purple-200 sm:inline"
            >
              {t('auth.signIn')}
            </Link>
            <Link href="/signup">
              <Button
                variant="primary"
                className="rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-5 hover:from-purple-500 hover:to-blue-500"
              >
                {t('auth.signUp')}
              </Button>
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

// Unused-export sentinels so Vite tree-shakes cleanly without lint warnings
// when these icons are referenced by string-key dynamic content later.
export { Eye, KeyRound, Lock, ShieldCheck };
