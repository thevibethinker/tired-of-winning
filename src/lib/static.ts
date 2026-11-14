/** Static archive build (GitHub Pages): no server, so results come from JSON files written at build time
 *  (scripts/build_pages.ts), visits are not counted, and the Trump clips (not in the public repo) are left out. */
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const apiUrl = (name: 'election' | 'reactions') => STATIC ? `${import.meta.env.BASE_URL}api/${name}.json` : `/api/${name}`;
