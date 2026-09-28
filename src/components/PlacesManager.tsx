import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { MapPinIcon, CheckIcon, CloseIcon } from './Icons'

/** Two-step delete so a misclick cannot destroy a record. */
function ConfirmDelete({
  label,
  confirmLabel,
  onConfirm
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button type="button" className="btn btn--danger btn--sm" onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }
  return (
    <>
      <button
        type="button"
        className="btn btn--danger btn--sm"
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        <CheckIcon className="btn__icon" />
        {confirmLabel}
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setArmed(false)}>
        <CloseIcon className="btn__icon" />
      </button>
    </>
  )
}

export function PlacesManager() {
  const {
    t,
    allPlaces,
    addPlace,
    renamePlace,
    archivePlace,
    restorePlace,
    deletePlace,
    placeRequests,
    approveRequest,
    rejectRequest,
    deletePlaceRequest
  } = useApp()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const submitNew = () => {
    if (addPlace(name).ok) setName('')
  }

  const submitRename = (id: string) => {
    if (renamePlace(id, draft).ok) {
      setEditing(null)
      setDraft('')
    }
  }

  return (
    <>
      <section className="card anim-fade">
        <h2 className="card__title">
          <MapPinIcon className="card__titleIcon" />
          {t('placeRequests')}
        </h2>

        {placeRequests.length === 0 ? (
          <p className="empty">{t('noRequests')}</p>
        ) : (
          <ul className="statuslist">
            {placeRequests.map((request, index) => {
              const who = request.userId
              return (
                <li
                  key={request.id}
                  className="statuslist__row"
                  style={{ '--i': Math.min(index, 10) } as React.CSSProperties}
                >
                  <div className="statuslist__day">
                    <strong>{request.name}</strong>
                    <small>{t('requestedBy')} {who === 'u_demo' ? 'Demo Rider' : who}</small>
                  </div>
                  <div className="rowactions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => approveRequest(request.id)}
                    >
                      <CheckIcon className="btn__icon" />
                      {t('approve')}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => rejectRequest(request.id)}
                    >
                      <CloseIcon className="btn__icon" />
                      {t('reject')}
                    </button>
                    <ConfirmDelete
                      label={t('deleteRequest')}
                      confirmLabel={t('confirmDelete')}
                      onConfirm={() => deletePlaceRequest(request.id)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card anim-fade">
        <h2 className="card__title">
          <MapPinIcon className="card__titleIcon" />
          {t('managePlaces')}
        </h2>

        <div className="inlineadd">
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew()
            }}
            placeholder={t('placeName')}
          />
          <button type="button" className="btn btn--primary" onClick={submitNew}>
            {t('addPlace')}
          </button>
        </div>

        {allPlaces.length === 0 ? (
          <p className="empty">{t('noPlaces')}</p>
        ) : (
          <ul className="placelist placelist--admin">
            {allPlaces.map((place, index) => (
              <li key={place.id} className="placelist__row anim-stagger" style={{ '--i': index } as React.CSSProperties}>
                {editing === place.id ? (
                  <>
                    <input
                      className="field__input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(place.id)
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => submitRename(place.id)}
                    >
                      <CheckIcon className="btn__icon" />
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setEditing(null)}
                    >
                      <CloseIcon className="btn__icon" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className={place.active ? '' : 'is-archived'}>{place.name}</span>
                    <span className="rowactions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setEditing(place.id)
                          setDraft(place.name)
                        }}
                      >
                        {t('rename')}
                      </button>
                      {place.active ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => archivePlace(place.id)}
                          >
                            {t('remove')}
                          </button>
                          <ConfirmDelete
                            label={t('deletePlace')}
                            confirmLabel={t('confirmDelete')}
                            onConfirm={() => deletePlace(place.id)}
                          />
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => restorePlace(place.id)}
                        >
                          {t('restore')}
                        </button>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
