import type { SubStatus } from '../lib/types'
import { useApp } from '../context/useApp'
import { SUB_STATUS_LABEL } from '../lib/status'

export function StatusBadge({
  status,
  size = 'md'
}: {
  status: SubStatus
  size?: 'sm' | 'md'
}) {
  const { t } = useApp()
  return (
    <span className={`badge badge--${status} badge--${size}`}>
      <span className="badge__dot" aria-hidden="true" />
      {t(SUB_STATUS_LABEL[status])}
    </span>
  )
}
