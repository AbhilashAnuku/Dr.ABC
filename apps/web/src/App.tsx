import { type ComponentType, Suspense, lazy } from 'react';
import { Redirect, Route, Switch } from 'wouter';
import { FeatureErrorBoundary } from './components/coming-soon-notice.tsx';
import { AppShell } from './layout/app-shell.tsx';
import { FaceCameraTracker } from './overlay/face-camera-tracker.tsx';
import { GlobalVoiceListener } from './overlay/global-voice-listener.tsx';
import { MorbiusGlobalVoice } from './overlay/morbius-global-voice.tsx';
import { MorbiusNarrator } from './overlay/morbius-narrator.tsx';
import { MorbiusOverlay } from './overlay/morbius-overlay.tsx';
import { MorbiusProactiveNarrator } from './overlay/morbius-proactive-narrator.tsx';
import { ApiKeysPage } from './routes/api-keys.tsx';
import { AppointmentsPage } from './routes/appointments.tsx';
import { CaseLibraryPage } from './routes/case-library.tsx';
import { ConsultPage } from './routes/consult.tsx';
import { DashboardPage } from './routes/dashboard.tsx';
import { ForgotPasswordPage } from './routes/forgot-password.tsx';
import { InsurancePage } from './routes/insurance.tsx';
import { LandingPage } from './routes/landing.tsx';
import { LoginPage } from './routes/login.tsx';
import { ProfilePage } from './routes/profile.tsx';
import { SettingsPage } from './routes/settings.tsx';
import { SignupPage } from './routes/signup.tsx';
import { WellnessPage } from './routes/wellness.tsx';

// Heavy / rarely-visited routes are dynamic-imported so the initial
// bundle stays under ~1 MB pre-gzip. Three.js (brain map) + the dev
// console + the scribe lazy-load on first navigation.
const BrainPage = lazy(() => import('./routes/brain.tsx').then((m) => ({ default: m.BrainPage })));
const NeuralCorePage = lazy(() =>
  import('./routes/neural-core.tsx').then((m) => ({ default: m.NeuralCorePage })),
);
const DevConsolePage = lazy(() =>
  import('./routes/dev-console.tsx').then((m) => ({ default: m.DevConsolePage })),
);
const AgentsRoomPage = lazy(() =>
  import('./routes/agents-room.tsx').then((m) => ({ default: m.AgentsRoomPage })),
);
const ArchitecturePage = lazy(() =>
  import('./routes/architecture.tsx').then((m) => ({ default: m.ArchitecturePage })),
);

function RouteFallback() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
        loading module
      </div>
      <div className="font-display text-xl text-app-primary">Mörbius</div>
    </div>
  );
}

/**
 * Stage 8 route table — collapsed surface, two roles only.
 *
 * Public:    landing · login · signup · forgot-password
 * App:       dashboard · clinic · appointments · profile · settings
 *
 * Imaging (`/app/imaging`) lands in Wave V; until then there's only
 * the medical core. The role gates that wrapped /app/console and
 * friends are gone — those routes were deleted in Wave R.
 */
// Boundary lives inside the shell so the sidebar + topbar stay visible;
// only the failing surface falls back to the ComingSoonNotice. Each
// route passes its own label so the friendly message names the actual
// surface that broke.
function withShell(Component: ComponentType, feature: string) {
  return () => (
    <AppShell>
      <FeatureErrorBoundary feature={feature}>
        <Suspense fallback={<RouteFallback />}>
          <Component />
        </Suspense>
      </FeatureErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  return (
    <>
      <Switch>
        {/* Public */}
        <Route path="/" component={LandingPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />

        {/* App (auth-required, wrapped in AppShell) */}
        <Route path="/app" component={withShell(DashboardPage, 'Dashboard')} />
        {/* /app/consult — the single consultation surface. The legacy
            /app/clinic now redirects here so there's exactly one
            consultation route. Imaging is folded into the consult
            composer via the camera-attach button. */}
        <Route path="/app/consult" component={withShell(ConsultPage, 'Consultation')} />
        <Route path="/app/clinic">
          <Redirect to="/app/consult" />
        </Route>
        <Route path="/app/case-library" component={withShell(CaseLibraryPage, 'Case library')} />
        <Route path="/app/imaging">
          <Redirect to="/app/consult" />
        </Route>
        <Route path="/app/brain" component={withShell(BrainPage, 'Brain map')} />
        <Route path="/app/neural-core" component={withShell(NeuralCorePage, 'Neural core')} />
        <Route path="/app/dev-console" component={withShell(DevConsolePage, 'Dev console')} />
        <Route path="/app/architecture" component={withShell(ArchitecturePage, 'Architecture')} />
        <Route path="/app/agents-room" component={withShell(AgentsRoomPage, 'Agents room')} />
        {/* /app/scribe — retired in favor of the single consultation +
            imaging surface. The page redirects to the consult surface
            so any old bookmarks land somewhere sensible. */}
        <Route path="/app/scribe">
          <Redirect to="/app/consult" />
        </Route>
        <Route path="/app/api-keys" component={withShell(ApiKeysPage, 'API keys')} />
        <Route path="/app/appointments" component={withShell(AppointmentsPage, 'Schedule')} />
        {/* /app/wellness — wired to its own WellnessPage component so
            records and wellness are distinct surfaces. ProfilePage shows
            the FHIR record + medical history; WellnessPage shows
            hydration / sleep / steps / diet / alerts as its own
            surface. */}
        <Route path="/app/wellness" component={withShell(WellnessPage, 'Wellness')} />
        {/* /app/insurance — Mörbius's "help me choose a health plan"
            surface. Lists German statutory + private plans + the
            recommender card that compares them against the patient
            profile. */}
        <Route path="/app/insurance" component={withShell(InsurancePage, 'Insurance')} />
        <Route path="/app/profile" component={withShell(ProfilePage, 'Records')} />
        <Route path="/app/settings" component={withShell(SettingsPage, 'Settings')} />

        {/* Fallback */}
        <Route>
          <NotFound />
        </Route>
      </Switch>

      {/* Mörbius global assistant — always present. */}
      <MorbiusOverlay />
      {/* First-run guided tour — fires once per user, replayable from Settings. */}
      <MorbiusNarrator />
      {/* Optional: drives the avatar's head from the user's face via
          MediaPipe (only mounts a camera when the toggle is ON). */}
      <FaceCameraTracker />
      {/* Always-on voice navigation — say "Mörbius open settings" /
          "Mörbius go to brain map" / "Mörbius stop" from anywhere. */}
      <GlobalVoiceListener />

      {/* Mörbius global voice — listens for `morbius:speak` custom
          events from any analysis surface (imaging, diagnostic, harness,
          etc.) and routes them to TTS, enabling Mörbius to speak any
          analysis result from anywhere in the app. */}
      <MorbiusGlobalVoice />

      {/* Mörbius proactive narrator — daily-life caretaker. Pulls Google
          Fit vitals on sign-in, fires water/midday/evening cues
          throughout the day. Permission-gated by Mörbius permissions
          panel (settings → security → speak). */}
      <MorbiusProactiveNarrator />
    </>
  );
}

function NotFound() {
  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">404</div>
      <h1 className="font-display text-3xl font-bold text-app-primary">Page not found</h1>
      <p className="font-sans text-sm text-app-muted">
        The page you were looking for doesn't exist (yet). Use the sidebar or go{' '}
        <a href="/" className="text-quantum-400 hover:text-quantum-300">
          home
        </a>
        .
      </p>
    </div>
  );
}
