// Password rules per Figma toast (sign-up 211:12899, recovery 138:7959,
// change-password 353:12228 — same toast copy in all three):
//   - 8 characters minimum, letters and numbers
//   - 1 symbol from @#$%ˆ
//   - 1 uppercase letter
//
// Shared between sign-up.tsx, password-recovery/new-password.tsx and
// settings/change-password.tsx. Before this file existed (2026-05-17),
// the same function was copy-pasted in sign-up.tsx and new-password.tsx.

export interface PasswordChecks {
  length: boolean;
  lettersAndNumbers: boolean;
  symbol: boolean;
  uppercase: boolean;
}

export function validatePassword(pw: string): PasswordChecks {
  return {
    length: pw.length >= 8,
    lettersAndNumbers: /[A-Za-z]/.test(pw) && /[0-9]/.test(pw),
    symbol: /[@#$%^]/.test(pw),
    uppercase: /[A-Z]/.test(pw),
  };
}

export function isPasswordValid(pw: string): boolean {
  return Object.values(validatePassword(pw)).every(Boolean);
}
