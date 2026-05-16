import { useEffect, type ReactElement } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { LoginButton, ScreenNameForm, useAuth } from '@a-conversa/shell';

import { SurfaceHost, rememberReturnTo, takeRememberedReturnTo } from './surfaces/SurfaceHost';

function resolvePostAuthTarget(): string {
  return takeRememberedReturnTo() ?? '/';
}

function LoadingFrame(): ReactElement {
  const { t } = useTranslation();
  return (
    <main data-testid="route-login" className="mx-auto max-w-2xl p-6">
      <h1 data-testid="route-title" className="text-2xl font-semibold">{t('auth.login.title')}</h1>
      <p data-testid="auth-checking">{t('auth.login.checking')}</p>
    </main>
  );
}

function TopBanner(): ReactElement {
  const { t } = useTranslation();
  const auth = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-semibold tracking-tight text-slate-900">a-conversa</Link>
          <nav className="hidden items-center gap-4 text-sm text-slate-600 md:flex">
            <Link to="/why" className="hover:text-slate-900">Why it matters</Link>
            <Link to="/methodology" className="hover:text-slate-900">Methodology</Link>
            <Link to="/roles" className="hover:text-slate-900">Roles & surfaces</Link>
            <Link to="/walkthrough" className="hover:text-slate-900">Example walkthrough</Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {auth.status === 'authenticated' && auth.user !== undefined ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Logged in as {auth.user.screenName}</span>
          ) : (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">Visitor mode</span>
          )}
          <Link to="/m/sessions/new" data-testid="root-start-session" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">{t('moderator.createSession.title')}</Link>
          {auth.status === 'authenticated' ? (
            <>
              <Link to="/m" data-testid="root-open-moderator" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Open moderator</Link>
              <Link to="/logout" data-testid="root-logout-link" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white">{t('auth.login.logout')}</Link>
            </>
          ) : (
            <LoginButton className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white" />
          )}
        </div>
      </div>
    </header>
  );
}

function Shell({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="bg-gradient-to-b from-slate-50 to-white min-h-screen">
      <TopBanner />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10" data-testid="route-home">{children}</main>
    </div>
  );
}

function HomePage(): ReactElement {
  return (
    <Shell>
      <section className="grid gap-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">A platform for productive disagreement</p>
          <h1 data-testid="route-title" className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">Turn heat into structure, and structure into progress.</h1>
          <p className="mt-4 text-slate-600">a-conversa is designed for conversations where truth, values, and trade-offs get tangled. Instead of debating faster, participants debate slower with explicit claim typing, relation mapping, and mutual commit checkpoints.</p>
          <div className="mt-6 flex gap-3">
            <Link to="/why" className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white">See why teams use it</Link>
            <Link to="/methodology" className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700">Explore the method</Link>
            <Link to="/walkthrough" className="rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700">Read a full walkthrough</Link>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">At a glance</h2>
          <ul className="mt-3 space-y-3 text-sm text-slate-700">
            <li>• Capture exact statements before interpretation drifts.</li>
            <li>• Classify each claim type to avoid category mistakes.</li>
            <li>• Link support, rebuttal, qualification, and dependency.</li>
            <li>• Require visible consent before claims enter the shared graph.</li>
            <li>• Surface disputes as concrete forks, not personal attacks.</li>
          </ul>
        </div>
      </section>
    </Shell>
  );
}

function WhyPage(): ReactElement {
  return <Shell><section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><h1 data-testid="route-title" className="text-3xl font-semibold text-slate-900">Why this matters</h1><p className="mt-4 text-slate-700">Most high-stakes debates fail for structural reasons: mixed claim types, implicit assumptions, and untracked logical dependencies. a-conversa makes those failure points visible so groups can disagree without collapsing into repetition.</p><div className="mt-6 grid gap-4 md:grid-cols-3"><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold">For civic forums</h2><p className="mt-2 text-sm text-slate-600">Create accountable deliberation where audience members can inspect how positions evolved.</p></article><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold">For organizations</h2><p className="mt-2 text-sm text-slate-600">Reduce costly decision churn by documenting what was agreed, disputed, or deferred.</p></article><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold">For education</h2><p className="mt-2 text-sm text-slate-600">Teach rigorous argumentation by separating evidence, norms, and definitions in real time.</p></article></div></section></Shell>;
}

function MethodologyPage(): ReactElement {
  return <Shell><section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><h1 data-testid="route-title" className="text-3xl font-semibold text-slate-900">Methodology in detail</h1><p className="mt-4 text-slate-700">The method is a repeated 6-step loop with moderation safeguards. If consensus fails at any step, the claim is decomposed, split by interpretation, or tagged as an axiom-level disagreement before re-voting.</p><ol className="mt-6 grid gap-4 md:grid-cols-2">{['Capture verbatim statement','Classify claim facet (fact/value/prediction/norm/definition)','Bind evidence or reference context','Map relations (supports/rebuts/qualifies/depends-on)','Run participant consent check','Commit, fork, or dispute-resolve'].map((step, i)=><li key={step} className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><span className="mr-2 font-semibold text-slate-900">{i+1}.</span>{step}</li>)}</ol><svg viewBox="0 0 980 220" className="mt-8 w-full" role="img" aria-label="a-conversa methodology loop"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#475569" /></marker></defs><rect x="25" y="55" width="140" height="60" rx="12" fill="#eef2ff"/><text x="45" y="90" fontSize="12" fill="#0f172a">Capture</text><rect x="185" y="55" width="140" height="60" rx="12" fill="#ecfeff"/><text x="205" y="90" fontSize="12" fill="#0f172a">Classify</text><rect x="345" y="55" width="140" height="60" rx="12" fill="#f0fdf4"/><text x="365" y="90" fontSize="12" fill="#0f172a">Context</text><rect x="505" y="55" width="140" height="60" rx="12" fill="#fff7ed"/><text x="525" y="90" fontSize="12" fill="#0f172a">Relate</text><rect x="665" y="55" width="140" height="60" rx="12" fill="#fdf4ff"/><text x="688" y="90" fontSize="12" fill="#0f172a">Consent</text><rect x="825" y="55" width="130" height="60" rx="12" fill="#f8fafc"/><text x="843" y="90" fontSize="12" fill="#0f172a">Commit</text><line x1="165" y1="85" x2="185" y2="85" stroke="#475569" markerEnd="url(#arrow)"/><line x1="325" y1="85" x2="345" y2="85" stroke="#475569" markerEnd="url(#arrow)"/><line x1="485" y1="85" x2="505" y2="85" stroke="#475569" markerEnd="url(#arrow)"/><line x1="645" y1="85" x2="665" y2="85" stroke="#475569" markerEnd="url(#arrow)"/><line x1="805" y1="85" x2="825" y2="85" stroke="#475569" markerEnd="url(#arrow)"/><path d="M 890 120 C 880 180, 120 180, 95 120" fill="none" stroke="#64748b" strokeWidth="2" markerEnd="url(#arrow)"/><text x="352" y="205" fontSize="12" fill="#475569">Dispute path: decompose/split/axiom-tag then repeat loop</text></svg></section></Shell>;
}

function RolesPage(): ReactElement { return <Shell><section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><h1 data-testid="route-title" className="text-3xl font-semibold text-slate-900">Roles and surfaces</h1><div className="mt-6 grid gap-4 md:grid-cols-3"><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold">Moderator console</h2><p className="mt-2 text-sm text-slate-600">Owns capture fidelity, claim decomposition, and the final commit gate.</p></article><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold">Participant tablets</h2><p className="mt-2 text-sm text-slate-600">Each participant can classify, vote, challenge, and request interpretive splits.</p></article><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold">Audience view</h2><p className="mt-2 text-sm text-slate-600">Observers follow the graph and inspect which nodes are stable versus disputed.</p></article></div></section></Shell>; }

function WalkthroughPage(): ReactElement {
  return <Shell><section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"><h1 data-testid="route-title" className="text-3xl font-semibold text-slate-900">Example: how one debate unfolds</h1><p className="mt-4 text-slate-700">Scenario: two participants debate the claim "Our city should replace downtown parking with bus lanes." The moderator guides the process so both sides commit to structure, not slogans.</p><div className="mt-6 space-y-4"><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold text-slate-900">1) Moderator role: precision and neutrality</h2><p className="mt-2 text-sm text-slate-600">The moderator captures each statement verbatim, asks clarifying questions, and splits overloaded claims. They do not decide who is right—they protect the integrity of the map.</p></article><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold text-slate-900">2) Participant commitment: explicit, reversible votes</h2><p className="mt-2 text-sm text-slate-600">Participants agree to classify claim type, vote on interpretation, and accept that only consented nodes are committed. They can dispute, request decomposition, or withdraw support as new links appear.</p></article><article className="rounded-2xl border border-slate-200 p-5"><h2 className="font-semibold text-slate-900">3) Unfolding the debate in rounds</h2><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-600"><li><span className="font-medium text-slate-800">Round A:</span> Claim captured and typed as normative.</li><li><span className="font-medium text-slate-800">Round B:</span> Supporting predictive claim added: "bus lanes will cut commute time by 20%."</li><li><span className="font-medium text-slate-800">Round C:</span> Opponent rebuts with evidentiary claim and asks for source quality check.</li><li><span className="font-medium text-slate-800">Round D:</span> Moderator decomposes into subclaims: traffic flow, accessibility, and small-business impact.</li><li><span className="font-medium text-slate-800">Round E:</span> Participants commit on two subclaims, dispute one, and tag one value-level axiom split.</li></ul></article><article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="font-semibold text-emerald-900">Outcome</h2><p className="mt-2 text-sm text-emerald-800">The group may still disagree on policy, but the disagreement is now transparent: which facts are unsettled, which values diverge, and which claims already reached shared commitment.</p></article></div></section></Shell>;
}

function LandingRoute(): ReactElement {
  const auth = useAuth();
  if (auth.status === 'loading') return <LoadingFrame />;
  if (auth.status === 'needs-screen-name') return <Navigate to="/screen-name" replace />;
  if (auth.status === 'authenticated' && auth.user !== undefined) {
    const remembered = takeRememberedReturnTo();
    if (remembered !== undefined) return <Navigate to={remembered} replace />;
  }
  return <HomePage />;
}

function LoginRoute(): ReactElement { const { t } = useTranslation(); const auth = useAuth(); if (auth.status === 'loading') return <LoadingFrame />; if (auth.status === 'needs-screen-name') return <Navigate to="/screen-name" replace />; if (auth.status === 'authenticated') return <Navigate to={resolvePostAuthTarget()} replace />; return <main data-testid="route-login" className="mx-auto max-w-2xl p-6"><h1 data-testid="route-title" className="text-2xl font-semibold">{t('auth.login.title')}</h1><div className="mt-4"><LoginButton className="inline-flex rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white" /></div></main>; }
function ScreenNameRoute(): ReactElement { const { t } = useTranslation(); const auth = useAuth(); const location = useLocation(); if (auth.status === 'loading') return <LoadingFrame />; const fromCallback = new URLSearchParams(location.search).get('from') === 'callback'; if (auth.status === 'unauthenticated' && !fromCallback) return <Navigate to="/login" replace />; if (auth.status === 'authenticated') return <Navigate to={resolvePostAuthTarget()} replace />; return <main data-testid="route-screen-name" className="mx-auto max-w-2xl p-6"><h1 data-testid="route-title" className="text-2xl font-semibold">{t('auth.screenName.title')}</h1><ScreenNameForm onSuccess={() => undefined} /></main>; }
function LogoutRoute(): ReactElement { const { t } = useTranslation(); useEffect(() => { if (typeof window !== 'undefined') window.sessionStorage.removeItem('a-conversa:return-to'); void (async () => { try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } finally { window.location.replace('/login'); } })(); }, []); return <main data-testid="route-logout" className="mx-auto max-w-2xl p-6"><h1 data-testid="route-title" className="text-2xl font-semibold">{t('auth.login.logout')}</h1></main>; }
function AuthCallbackRoute(): ReactElement { const location = useLocation(); const searchParams = new URLSearchParams(location.search); const returnTo = searchParams.get('return_to'); if (returnTo !== null) rememberReturnTo(returnTo); return <Navigate to="/login" replace />; }

export default function App(): ReactElement {
  return <Routes><Route path="/" element={<LandingRoute />} /><Route path="/why" element={<WhyPage />} /><Route path="/methodology" element={<MethodologyPage />} /><Route path="/roles" element={<RolesPage />} /><Route path="/walkthrough" element={<WalkthroughPage />} /><Route path="/login" element={<LoginRoute />} /><Route path="/screen-name" element={<ScreenNameRoute />} /><Route path="/logout" element={<LogoutRoute />} /><Route path="/auth/callback" element={<AuthCallbackRoute />} /><Route path="/m/*" element={<SurfaceHost surfaceId="moderator" routerBasePath="/m" />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}
