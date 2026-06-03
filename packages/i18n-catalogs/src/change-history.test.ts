// Tests for the moderator change-history pane catalog entries.
//
// Refinement: tasks/refinements/moderator-ui/mod_history_scroller.md
// ADRs:        docs/adr/0024-frontend-i18n-react-i18next-with-icu.md,
//              docs/adr/0022-no-throwaway-verifications.md
// TaskJuggler: moderator_ui.mod_change_history_pane.mod_history_scroller
//
// Acceptance §5: every new `moderator.changeHistory.*` key (including
// each per-`EventKind` label) resolves to a non-empty, locale-distinct
// string in en-US / pt-BR / es-419.
//
// Per ADR 0022 this is a committed regression test — the empirical
// question "do the change-history keys resolve in every locale" is
// answered here and re-answered on every CI run.

import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ICU from 'i18next-icu';

import { buildInitOptions, SUPPORTED_LOCALES, type SupportedLocale } from './config.js';

// The 17 `EventKind` values. Mirrors the canonical wire vocabulary in
// `packages/shared-types/src/events.ts` (`eventKinds`); held here as a
// literal so this package keeps no dependency on shared-types (same
// convention as `keyboard-shortcuts.ts` / `methodology.test.ts`). Adding
// a new event kind requires adding it here so the round-trip catches a
// missing per-kind catalog entry.
const EVENT_KINDS = [
  'session-created',
  'session-ended',
  'participant-joined',
  'participant-left',
  'node-created',
  'edge-created',
  'annotation-created',
  'entity-included',
  'proposal',
  'vote',
  'commit',
  'meta-disagreement-marked',
  'snapshot-created',
  'entity-removed',
  'session-mode-changed',
  'withdraw-agreement',
  'proposal-withdrawn',
] as const;

// The flat (non-`kind`) leaf keys under `moderator.changeHistory`.
const FLAT_KEYS = [
  'paneAriaLabel',
  'systemActor',
  'loading',
  'error',
  'retry',
  'emptyState',
] as const;

// The summary enum-label leaf keys under `moderator.changeHistory.summary`
// (`mod_history_event_summary`). These are static labels (no ICU
// placeholders) so they participate in the plain resolve + locale-distinct
// round-trip alongside the `kind.*` labels. The two ICU *templates*
// (`participantJoined`, `sessionModeChanged`) carry placeholders and are
// asserted separately (they render to a locale-independent separator with
// no args, so they can't be in the bare round-trip).
const SUMMARY_ENUM_KEYS = [
  'edgeRole.supports',
  'edgeRole.rebuts',
  'edgeRole.qualifies',
  'edgeRole.bridges-from',
  'edgeRole.bridges-to',
  'edgeRole.defines',
  'edgeRole.contradicts',
  'choice.agree',
  'choice.dispute',
  'entityKind.node',
  'entityKind.edge',
  'entityKind.annotation',
  'facet.classification',
  'facet.substance',
  'facet.wording',
  'facet.shape',
] as const;

// The summary ICU templates + sample values mirroring what
// `summarizeEvent` emits at runtime (the participant role is a select-safe
// token, not the hyphenated enum value).
const SUMMARY_TEMPLATES = [
  {
    key: 'moderator.changeHistory.summary.participantJoined',
    values: { name: 'Alice', role: 'debaterA' },
  },
  {
    key: 'moderator.changeHistory.summary.sessionModeChanged',
    values: { previous: 'lobby', next: 'operate' },
  },
] as const;

function allKeys(): readonly string[] {
  return [
    ...FLAT_KEYS.map((leaf) => `moderator.changeHistory.${leaf}`),
    ...EVENT_KINDS.map((kind) => `moderator.changeHistory.kind.${kind}`),
    ...SUMMARY_ENUM_KEYS.map((leaf) => `moderator.changeHistory.summary.${leaf}`),
  ];
}

async function makeT(
  locale: SupportedLocale,
): Promise<(key: string, values?: Record<string, string>) => string> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init(buildInitOptions(locale));
  return (key: string, values?: Record<string, string>) => instance.t(key, values ?? {});
}

describe('moderator changeHistory catalog round-trip', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const key of allKeys()) {
        it(`resolves ${key} to a non-empty string`, async () => {
          const t = await makeT(locale);
          const value = t(key);
          expect(value).toBeTruthy();
          expect(value.length).toBeGreaterThan(0);
          // i18next returns the dotted key itself when an entry is missing.
          expect(value).not.toBe(key);
        });
      }
    });
  }
});

describe('moderator changeHistory: non-en-US locales translate (not copy) en-US', () => {
  it('every change-history key resolves to a locale-distinct string', async () => {
    const tEn = await makeT('en-US');
    const tPt = await makeT('pt-BR');
    const tEs = await makeT('es-419');
    for (const key of allKeys()) {
      const en = tEn(key);
      expect(tPt(key), `pt-BR.${key} should differ from en-US`).not.toBe(en);
      expect(tEs(key), `es-419.${key} should differ from en-US`).not.toBe(en);
    }
  });
});

describe('moderator changeHistory summary: ICU templates render with sample values', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(`locale ${locale}`, () => {
      for (const { key, values } of SUMMARY_TEMPLATES) {
        it(`${key} interpolates with no leftover {placeholder}`, async () => {
          const t = await makeT(locale);
          const value = t(key, values);
          expect(value).toBeTruthy();
          expect(value).not.toBe(key);
          // ADR 0024: no unresolved ICU placeholders survive the render.
          expect(value).not.toContain('{');
          expect(value).not.toContain('}');
        });
      }
    });
  }

  it('every summary ICU template renders locale-distinct from en-US', async () => {
    const tEn = await makeT('en-US');
    const tPt = await makeT('pt-BR');
    const tEs = await makeT('es-419');
    for (const { key, values } of SUMMARY_TEMPLATES) {
      const en = tEn(key, values);
      expect(tPt(key, values), `pt-BR.${key} should differ from en-US`).not.toBe(en);
      expect(tEs(key, values), `es-419.${key} should differ from en-US`).not.toBe(en);
    }
  });
});

describe('moderator changeHistory: known canonical translations', () => {
  it('en-US per-kind label for node-created is "Statement created"', async () => {
    const t = await makeT('en-US');
    expect(t('moderator.changeHistory.kind.node-created')).toBe('Statement created');
  });

  it('pt-BR systemActor is "Sistema"', async () => {
    const t = await makeT('pt-BR');
    expect(t('moderator.changeHistory.systemActor')).toBe('Sistema');
  });

  it('es-419 empty-state is "Aún no hay eventos"', async () => {
    const t = await makeT('es-419');
    expect(t('moderator.changeHistory.emptyState')).toBe('Aún no hay eventos');
  });
});
