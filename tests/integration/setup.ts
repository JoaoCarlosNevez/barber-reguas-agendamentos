// Lê URL/chaves do Supabase local e limpa o rate limit antes da suíte.
import { execSync } from 'node:child_process'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    apiUrl: string
    anonKey: string
    serviceRoleKey: string
  }
}

export default function setup(project: TestProject) {
  const out = execSync('npx supabase status -o env', { encoding: 'utf8' })
  const env = Object.fromEntries(
    out
      .split('\n')
      .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  )
  const apiUrl = env.API_URL
  const anonKey = env.ANON_KEY
  const serviceRoleKey = env.SERVICE_ROLE_KEY
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error('Supabase local não está rodando (npm run db:start).')
  }

  execSync(
    `docker exec supabase_db_agendareguas psql -U postgres -c "truncate private.rate_limits"`,
    { stdio: 'ignore' },
  )

  project.provide('apiUrl', apiUrl)
  project.provide('anonKey', anonKey)
  project.provide('serviceRoleKey', serviceRoleKey)
}
