import { initialsOf } from '../lib/avatar'

/**
 * Circular avatar. Shows the user's uploaded photo when there is one, otherwise
 * the first letter of their name on the brand-soft background.
 *
 * Size is a variant class rather than an inline style so the markup stays clean
 * and the sizes stay overridable from CSS.
 */
export function Avatar({
  name,
  src,
  variant = 'md',
  className = ''
}: {
  name: string
  src?: string | null
  /**
   * `ticket` is not a size but a shape: a square photo plate for the pass,
   * tilted like a stamp. The rest are circular sizes shared with the header and
   * the profile screen.
   */
  variant?: 'xs' | 'sm' | 'md' | 'lg' | 'ticket'
  className?: string
}) {
  if (src) {
    return (
      <span className={`avatar avatar--${variant} ${className}`}>
        <img src={src} alt="" className="avatar__img" />
      </span>
    )
  }

  return (
    <span className={`avatar avatar--letter avatar--${variant} ${className}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}