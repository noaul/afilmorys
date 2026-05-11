export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isEmailAllowed(email: string, allowedEmails: ReadonlySet<string>): boolean {
  return allowedEmails.size === 0 || allowedEmails.has(email.trim().toLowerCase())
}
