import { describe, expect, it } from 'vitest'

import { isRootDashboardPath, isRootHost } from './root-tenant-routing'

describe('root tenant routing', () => {
  it('matches base and local hosts as root hosts', () => {
    expect(isRootHost('afilmory.art', 'afilmory.art')).toBe(true)
    expect(isRootHost('localhost', 'afilmory.art')).toBe(true)
    expect(isRootHost('127.0.0.1', 'afilmory.art')).toBe(true)
    expect(isRootHost('home.afilmory.art', 'afilmory.art')).toBe(false)
  })

  it('routes dashboard and control-plane paths to the root tenant', () => {
    expect(isRootDashboardPath('/')).toBe(true)
    expect(isRootDashboardPath('/login')).toBe(true)
    expect(isRootDashboardPath('/root-login')).toBe(true)
    expect(isRootDashboardPath('/superadmin/settings')).toBe(true)
    expect(isRootDashboardPath('/assets/main.js')).toBe(true)
    expect(isRootDashboardPath('/api/super-admin/tenants')).toBe(true)
  })

  it('keeps public gallery paths tenantless on the root host', () => {
    expect(isRootDashboardPath('/photos/123')).toBe(false)
    expect(isRootDashboardPath('/explory')).toBe(false)
    expect(isRootDashboardPath('/favicon.ico')).toBe(false)
    expect(isRootDashboardPath('/api/auth/sign-up/email')).toBe(false)
  })
})
