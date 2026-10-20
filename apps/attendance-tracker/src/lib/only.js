/* Which single page this app was opened for, or null for all of them.

   The portal opens this app both ways: the Attendance Tracker tile
   lands on the whole thing, while a tile like Settings lands on one
   page with one button in the nav. Same shell either way -- the point
   of a tile that opens one page is that it still looks like the rest of
   the site.

   The flag rides in the query rather than the fragment because
   HashRouter owns the fragment, and in the query it survives navigation
   inside the app, which a one-shot piece of state would not.

   Narrowing the nav is tidiness, not access control. Every route stays
   mounted and each one carries its own guard, and behind those the
   database is what actually refuses anything. */
export const ONLY = new URLSearchParams(window.location.search).get('only')
