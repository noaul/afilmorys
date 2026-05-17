const ROOT_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

const ROOT_DASHBOARD_PATH_PREFIXES = [
  '/',
  '/login',
  '/root-login',
  '/welcome',
  '/tenant-missing',
  '/tenant-restricted',
  '/tenant-suspended',
  '/no-access',
  '/superadmin',
  '/assets',
  '/api/super-admin',
  '/api/settings',
  '/api/storage/settings',
  '/api/builder/settings',
] as const

export function isRootHost(host: string | null | undefined, baseDomain: string): boolean {
  const normalizedHost = host?.trim().toLowerCase() ?? ''
  if (!normalizedHost) {
    return false
  }

  const normalizedBase = baseDomain.trim().toLowerCase()
  return ROOT_HOSTS.has(normalizedHost) || (normalizedBase.length > 0 && normalizedHost === normalizedBase)
}

export function isRootDashboardPath(path: string | undefined): boolean {
  if (!path) {
    return false
  }

  const [pathname] = path.toLowerCase().split(/[?#]/, 1)
  const normalizedPath = pathname && pathname.length > 0 ? pathname.replace(/\/+$/, '') || '/' : '/'

  return ROOT_DASHBOARD_PATH_PREFIXES.some((prefix) => {
    if (prefix === '/') {
      return normalizedPath === '/'
    }
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  })
}
