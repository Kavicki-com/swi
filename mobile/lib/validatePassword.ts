// Shared password rules for sign-up, recovery and password changes:
//   - 8 characters minimum, letters and numbers
//   - 1 symbol from @#$%ˆ
//   - 1 uppercase letter
//
// Keep these checks centralized so all password flows enforce the same policy.

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
