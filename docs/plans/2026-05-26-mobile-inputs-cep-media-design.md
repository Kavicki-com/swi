# Mobile — Inputs validation + CEP lookup + Media flow fixes

**Date:** 2026-05-26
**Branch:** `feat/mobile-login`
**Status:** approved (proceed to implementation, no commits)

## Motivation

Three gaps in the mobile demo:

1. Input fields have only a "required" gate (`length > 0`) — no format validation, no masks, no error UI. Users can submit invalid email/CPF/CEP and advance.
2. `complimentary-data/step-2.tsx` asks for CEP but doesn't look it up — user fills 5 address fields by hand.
3. `complimentary-data/step-1.tsx`'s `ImageUploader` is stubbed (`{ uri: 'demo://placeholder' }`) — never opens camera/gallery. Other 4 screens that wire `expo-image-picker` duplicate the same code and use the deprecated `MediaTypeOptions.Images` API.

## Approach

### Frente 1 — Validação

Architecture: pure validators + small `useField` hook + DS Input's native `descriptionVariant="error"`.

- `lib/validation/validators.ts` — pure functions returning `{ valid: boolean; error?: string }`:
  - `validateEmail`, `validateCPF` (with check digit), `validateCEP`, `validateUF`, `validatePhone`, `validateBirthDate`, `validateRequired`, `validateFullName`.
  - Password validation already lives in `lib/validatePassword.ts` — keep, expose adapter `validatePasswordField` returning the same shape.
- `lib/validation/masks.ts` — pure formatters: `maskCPF`, `maskPhone`, `maskCEP`, `maskBirthDate`, `maskUF`.
- `lib/forms/useField.ts` — hook returning `{ value, onChangeText, onBlur, error, touched, isValid, setValue }`. Caller wires `value`/`onChangeText`/`onBlur` + spreads `error ? { description: error, descriptionVariant: 'error' as const } : {}` into DS `<Input>`. Error visibility is gated by `touched` (only after first blur), so users don't see errors on a pristine field.
- Submit gate: each screen derives `canSubmit` from `fields.every(f => f.isValid)`. CTA stays `disabled` until valid.

Timing: validation runs on every `onChangeText` (cheap, pure) so `canSubmit` updates live, but error message renders only after `onBlur` has fired once (less noisy UX).

### Frente 2 — CEP

- New dep: `cep-promise` (~50KB, 4-provider fallback, RN-compatible, no key).
- `lib/cep/useCepLookup.ts` — hook with signature `({ onSuccess, onError }) => { loading, lookup(cep) }`. Triggers on the CEP field's `onBlur` once the masked input has 8 digits.
- `step-2.tsx` rewires: street, neighborhood, UF auto-fill from lookup; on error, CEP field shows `'CEP não encontrado'` and the other fields become editable (no auto-fill). User can always override after fill.

### Frente 3 — Mídia

- `lib/media/useMediaPicker.ts` — single hook exposing:
  - `pickFromGallery(): Promise<string | null>` (URI of picked asset, `null` if canceled/denied)
  - `takePhoto(): Promise<string | null>`
  - `showPicker(): Promise<string | null>` — Alert with "Tirar foto" / "Escolher da galeria" / "Cancelar".
- Permission flow: if denied, single `Alert` w/ "Abrir configurações" → `Linking.openSettings()`.
- API: uses `mediaTypes: ['images']` (replaces deprecated `MediaTypeOptions.Images`).
- Defaults: `quality: 0.8`, `allowsEditing: true`.

Refactor sweep:
- **step-1.tsx**: ImageUploader's `onTakePhoto`/`onPickFile` wired to `useMediaPicker`. Removes the `'demo://placeholder'` stub.
- **chat/[userId].tsx**, **reports/new.tsx**, **journey/task/[id].tsx**, **my-stats.tsx**: replace local picker impls with hook calls. Removes ~80 lines of duplication. Restores any local UX bits (alerts, edit flow) on top.

## Scope per screen

| Screen | Validation | Masks | CEP | Media |
|---|---|---|---|---|
| `(auth)/login.tsx` | email + required password | — | — | — |
| `(auth)/sign-up.tsx` | name + email + pw rules + match + checkbox | — | — | — |
| `(auth)/password-recovery/email.tsx` | email | — | — | — |
| `(auth)/password-recovery/new-password.tsx` | pw rules + match | — | — | — |
| `(auth)/complimentary-data/step-1.tsx` | name + phone + CPF (check digit) + birthDate | phone, CPF, birthDate | — | step-1 wire |
| `(auth)/complimentary-data/step-2.tsx` | CEP + 4 address fields + UF | CEP, UF | **lookup on blur** | — |
| `(auth)/complimentary-data/step-3.tsx` | gender + height + weight + blood + disability | — | — | — |
| `(app)/settings/change-password.tsx` | pw rules + match | — | — | — |
| `(app)/chat/[userId].tsx` | — | — | — | hook sweep |
| `(app)/reports/new.tsx` | required titulo/resumo/detalhes | — | — | hook sweep |
| `(app)/journey/task/[id].tsx` | — | — | — | hook sweep |
| `(app)/my-stats.tsx` | — | — | — | hook sweep |

Settings personal-data/health-data use Comboboxes + multiline text (selectors + freeform descriptions) — no format validation, only required-state which already exists.

## Non-goals

- Backend integration: validation runs client-side, no server checks.
- Form library migration (react-hook-form, formik) — manual hook stays.
- DS Input bump: `descriptionVariant: 'error'` already exists in v0.1.109.
- Settings inputs that are Comboboxes / freeform multiline: out of scope.

## Risks

- `cep-promise` adds ~50KB. Acceptable.
- `expo-image-picker` API surface shifted between versions — verify `mediaTypes: ['images']` works in 17.0.11 (release notes confirm). If not, hook falls back to `MediaTypeOptions.Images` with a TODO.
- Strict validation may block demo presenters who type fake data. The user explicitly chose "Validação completa real"; honored.

## Implementation order

1. Add `cep-promise` dep + reinstall lockfile entry (no install run unless asked).
2. `lib/validation/validators.ts` + `lib/validation/masks.ts`.
3. `lib/forms/useField.ts`.
4. `lib/cep/useCepLookup.ts`.
5. `lib/media/useMediaPicker.ts`.
6. Auth screens: login → sign-up → password-recovery email → password-recovery new-password.
7. Comp-data: step-1 (validation + media) → step-2 (validation + CEP) → step-3 (validation only).
8. settings/change-password.tsx (validation).
9. Media sweep: chat, reports/new (also required-text gate), journey/task, my-stats.
10. Typecheck + smoke (no commits).
