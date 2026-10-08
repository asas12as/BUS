import { useState } from 'react'
import { useApp } from '../context/useApp'
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
    allBuses,
    addPlace,
    renamePlace,
    archivePlace,
    restorePlace,
    deletePlace
  } = useApp()
  const [busName, setBusName] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const submitBus = async () => {
    const result = await addPlace(busName, 'bus')
    if (result.ok) {
      setBusName('')
      setError('')
    } else {
      setError(result.error ?? '')
    }
  }

  const submitPlace = async () => {
    const result = await addPlace(placeName, 'place')
    if (result.ok) {
      setPlaceName('')
      setError('')
    } else {
      setError(result.error ?? '')
    }
  }

  const submitRename = async (id: string) => {
    const result = await renamePlace(id, draft)
    if (result.ok) {
      setEditing(null)
      setDraft('')
      setError('')
    } else {
      setError(result.error ?? '')
    }
  }

  return (
    <>
      <section className="card anim-fade">
        <h2 className="card__title">
          <MapPinIcon className="card__titleIcon" />
          {t('manageBuses')}
        </h2>

        <div className="inlineadd">
          <input
            className="field__input"
            value={busName}
            onChange={(e) => setBusName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitBus()
            }}
            placeholder={t('busName')}
          />
          <button type="button" className="btn btn--primary" onClick={() => void submitBus()}>
            {t('addBus')}
          </button>
        </div>

        {error && <p className="form__error">{error}</p>}

        {allBuses.length === 0 ? (
          <p className="empty">{t('noBuses')}</p>
        ) : (
          <ul className="placelist placelist--admin">
            {allBuses.map((place, index) => (
              <li key={place.id} className="placelist__row anim-stagger" style={{ '--i': index } as React.CSSProperties}>
                {editing === place.id ? (
                  <>
                    <input
                      className="field__input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitRename(place.id)
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => void submitRename(place.id)}
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

      <section className="card anim-fade">
        <h2 className="card__title">
          <MapPinIcon className="card__titleIcon" />
          {t('managePlaces')}
        </h2>

        <div className="inlineadd">
          <input
            className="field__input"
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitPlace()
            }}
            placeholder={t('placeName')}
          />
          <button type="button" className="btn btn--primary" onClick={() => void submitPlace()}>
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
                        if (e.key === 'Enter') void submitRename(place.id)
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => void submitRename(place.id)}
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
