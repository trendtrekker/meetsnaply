/**
 * The fields that make up a signed-in user everywhere they are needed — the
 * dashboard, and the API's `/me`. Never includes `passwordHash`.
 *
 * Kept in its own module, apart from ./index, because that file imports
 * `redirect` from next/navigation for `requireUser()`. Pulling the router in
 * just to name some columns drags React's client runtime along with it, which
 * breaks anything running under the `react-server` condition — route handlers
 * driven directly, the worker, and the tests.
 */
export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  username: true,
  avatarUrl: true,
  bio: true,
  timeZone: true,
  brandColor: true,
} as const;
