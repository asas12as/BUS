/**
 * The bus routes a driver can be assigned to for a given day.
 *
 * Its own module because it is a business list rather than storage: the admin
 * schedule editor offers these, and nothing about them is persisted in the
 * browser. The route name on a day entry is free text on the server, so an
 * operator can add one here without a migration.
 */
export const ROUTES = [
  'Route A - North',
  'Route B - City',
  'Route C - South',
  'Route D - Airport'
] as const