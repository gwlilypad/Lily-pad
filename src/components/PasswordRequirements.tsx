type Props = {
  password: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

export type PasswordValidation = {
  length: boolean;
  number: boolean;
  capital: boolean;
  notIdentity: boolean;
  allValid: boolean;
};

export function validatePassword({ password, email, firstName, lastName }: Props): PasswordValidation {
  const pw = password || "";
  const pwLower = pw.toLowerCase().trim();
  const length = pw.length >= 8;
  const number = /[0-9]/.test(pw);
  const capital = /[A-Z]/.test(pw);
  const identityValues = [email, firstName, lastName, [firstName, lastName].filter(Boolean).join("")]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map(v => v.toLowerCase().trim());
  const notIdentity = pw.length > 0 && !identityValues.includes(pwLower);
  return { length, number, capital, notIdentity, allValid: length && number && capital && notIdentity };
}

export default function PasswordRequirements(props: Props) {
  const v = validatePassword(props);
  const rules: { key: keyof PasswordValidation; label: string }[] = [
    { key: "length",      label: "At least 8 characters" },
    { key: "capital",     label: "1 capital letter (A–Z)" },
    { key: "number",      label: "1 number (0–9)" },
    { key: "notIdentity", label: "Not your name or email" },
  ];

  return (
    <div style={{
      width: "100%", marginTop: 14, padding: "12px 14px",
      borderRadius: 14, background: "rgba(14,31,64,0.04)",
      border: "1px solid rgba(14,31,64,0.08)",
      fontFamily: "'DM Sans',sans-serif",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.42)",
        letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8,
      }}>Password must include</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rules.map(r => {
          const ok = v[r.key];
          return (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                background: ok ? "#8DD63F" : "rgba(14,31,64,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.18s",
              }}>
                {ok ? (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                ) : (
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(14,31,64,0.32)" }} />
                )}
              </div>
              <span style={{
                fontSize: 12.5, fontWeight: ok ? 600 : 500,
                color: ok ? "#0E1F40" : "rgba(14,31,64,0.55)",
                transition: "color 0.18s",
              }}>{r.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
