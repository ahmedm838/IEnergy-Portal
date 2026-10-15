/**
 * The company mark.
 *
 * Served from public/ and referenced through BASE_URL so the same build
 * works at the site root and under /ienergy-attendance-tracker/ on
 * GitHub Pages. The mark is wider than it is tall, so height is fixed and
 * width follows.
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`

export default function Logo({ className = 'h-8', alt = 'IEnergy' }) {
  return <img src={LOGO_SRC} alt={alt} className={`${className} w-auto select-none`} />
}
