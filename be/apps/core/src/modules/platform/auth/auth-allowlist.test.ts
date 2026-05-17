import { describe, expect, it } from 'vitest'

import { isEmailAllowed, parseAllowedEmails } from './auth-allowlist'

describe('auth allowlist', () => {
  it('allows every email when the allowlist is empty', () => {
    expect(isEmailAllowed('user@example.com', parseAllowedEmails(undefined))).toBe(true)
  })

  it('matches configured emails case-insensitively', () => {
    const allowlist = parseAllowedEmails('Admin@Example.com, owner@example.com ')

    expect(isEmailAllowed('admin@example.com', allowlist)).toBe(true)
    expect(isEmailAllowed('OWNER@example.com', allowlist)).toBe(true)
    expect(isEmailAllowed('other@example.com', allowlist)).toBe(false)
  })
})
