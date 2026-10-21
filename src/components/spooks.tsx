import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import {
  getSpookPermissions,
  getSpookStoragePath,
  normalizeSpookRow,
  sortSpooksByNewest,
  type SpookRecord,
} from '../utils/spooks'
import './spooks.css'

type UserSummary = {
  id: string
  name: string
  avatar_url: string | null
}

type SpooksProps = {
  currentUserId: string
  users: UserSummary[]
  isAdmin?: boolean
}

type SpookRow = Omit<SpookRecord, 'tagged_user_ids'> & {
  spook_tagged_users: { user_id: string }[] | null
}

export function Spooks({ currentUserId, users, isAdmin = false }: SpooksProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCaption, setEditCaption] = useState('')
  const [editTaggedIds, setEditTaggedIds] = useState<string[]>([])
  const [busySpookId, setBusySpookId] = useState<string | null>(null)
  const [feed, setFeed] = useState<SpookRecord[]>([])
  const [caption, setCaption] = useState('')
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)

  useEffect(() => {
    const loadFeed = async () => {
      const { data, error: feedError } = await supabase
        .from('spooks')
        .select('*, spook_tagged_users(user_id)')
        .order('created_at', { ascending: false })

      if (feedError) {
        console.error('Failed to load spooks:', feedError)
        setError('Could not load the spook feed right now.')
        setFeed([])
        setIsLoading(false)
        return
      }

      setFeed(sortSpooksByNewest((data ?? []).map((row) => normalizeSpookRow(row as SpookRow))))
      setIsLoading(false)
    }

    void loadFeed()
  }, [])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    if (error) {
      setError('')
    }
  }

  const toggleTaggedUser = (userId: string) => {
    setTaggedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    )
    if (error) {
      setError('')
    }
  }

  const resetForm = () => {
    setCaption('')
    setTaggedUserIds([])
    setSelectedFile(null)
    const fileInput = document.getElementById('spook-image') as HTMLInputElement | null
    if (fileInput) {
      fileInput.value = ''
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedFile) {
      setError('Please choose an image to share as your spooky moment.')
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setError('Please choose a valid image file.')
      return
    }

    const trimmedCaption = caption.trim()
    if (!trimmedCaption) {
      setError('Add a short caption before posting.')
      return
    }

    setIsUploading(true)
    setError('')
    setStatusMessage('')

    try {
      const safeFileName = `${currentUserId}-${Date.now()}-${selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('spooks')
        .upload(safeFileName, selectedFile, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        throw uploadError
      }

      const { data: publicUrlData } = supabase.storage.from('spooks').getPublicUrl(uploadData.path)

      const { data: insertedSpook, error: insertError } = await supabase
        .from('spooks')
        .insert({
          user_id: currentUserId,
          caption: trimmedCaption,
          image_url: publicUrlData.publicUrl,
        })
        .select('id, user_id, caption, image_url, created_at')
        .single()

      if (insertError) {
        throw insertError
      }

      const spookId = (insertedSpook as { id: string }).id

      if (taggedUserIds.length > 0) {
        const { error: tagError } = await supabase
          .from('spook_tagged_users')
          .insert(taggedUserIds.map((userId) => ({ spook_id: spookId, user_id: userId })))

        if (tagError) {
          const { error: cleanupError } = await supabase.from('spooks').delete().eq('id', spookId)
          if (cleanupError) {
            console.error('Failed to roll back spook after tag insert failed:', cleanupError)
          }
          throw tagError
        }
      }

      const nextSpook: SpookRecord = {
        ...(insertedSpook as Omit<SpookRecord, 'tagged_user_ids'>),
        tagged_user_ids: [...taggedUserIds],
      }

      setFeed((currentFeed) => sortSpooksByNewest([nextSpook, ...currentFeed]))
      resetForm()
      setIsFormOpen(false)
      setStatusMessage('Spook posted successfully.')
    } catch (submitError) {
      console.error('Failed to create spook:', submitError)
      setError('Your spook could not be posted. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }

  const startEditing = (spook: SpookRecord) => {
    setEditingId(spook.id)
    setEditCaption(spook.caption)
    setEditTaggedIds([...spook.tagged_user_ids])
    setError('')
    setStatusMessage('')
  }

  const handleDelete = async (spook: SpookRecord) => {
    if (!window.confirm('Delete this spook? This cannot be undone.')) return

    setBusySpookId(spook.id)
    setError('')
    setStatusMessage('')

    try {
      // select() lets us detect an RLS-blocked delete, which otherwise succeeds with 0 rows
      const { data, error: deleteError } = await supabase
        .from('spooks')
        .delete()
        .eq('id', spook.id)
        .select('id')

      if (deleteError) throw deleteError
      if (!data || data.length === 0) {
        throw new Error('Delete was blocked: no spook was removed.')
      }

      // Storage policy only lets the file owner remove it, so admin deletes may leave the file behind
      const path = getSpookStoragePath(spook.image_url)
      if (path) {
        const { error: removeError } = await supabase.storage.from('spooks').remove([path])
        if (removeError) {
          console.warn('Spook deleted but image file could not be removed:', removeError)
        }
      }

      setFeed((current) => current.filter((item) => item.id !== spook.id))
      if (editingId === spook.id) setEditingId(null)
      setStatusMessage('Spook deleted.')
    } catch (deleteFailure) {
      console.error('Failed to delete spook:', deleteFailure)
      setError('The spook could not be deleted. You may not have permission.')
    } finally {
      setBusySpookId(null)
    }
  }

  const handleSaveEdit = async (spook: SpookRecord) => {
    const trimmedCaption = editCaption.trim()
    if (!trimmedCaption) {
      setError('Add a short caption before saving.')
      return
    }

    setBusySpookId(spook.id)
    setError('')
    setStatusMessage('')

    try {
      const { data: updated, error: updateError } = await supabase
        .from('spooks')
        .update({ caption: trimmedCaption })
        .eq('id', spook.id)
        .select('id')

      if (updateError) throw updateError
      if (!updated || updated.length === 0) {
        throw new Error('Update was blocked: no spook was changed.')
      }

      const removedIds = spook.tagged_user_ids.filter((id) => !editTaggedIds.includes(id))
      const addedIds = editTaggedIds.filter((id) => !spook.tagged_user_ids.includes(id))

      if (removedIds.length > 0) {
        const { error: removeError } = await supabase
          .from('spook_tagged_users')
          .delete()
          .eq('spook_id', spook.id)
          .in('user_id', removedIds)
        if (removeError) throw removeError
      }

      if (addedIds.length > 0) {
        const { error: addError } = await supabase
          .from('spook_tagged_users')
          .insert(addedIds.map((userId) => ({ spook_id: spook.id, user_id: userId })))
        if (addError) throw addError
      }

      setFeed((current) =>
        current.map((item) =>
          item.id === spook.id
            ? { ...item, caption: trimmedCaption, tagged_user_ids: [...editTaggedIds] }
            : item,
        ),
      )
      setEditingId(null)
      setStatusMessage('Spook updated.')
    } catch (saveFailure) {
      console.error('Failed to update spook:', saveFailure)
      setError('The spook could not be updated. Please try again.')
    } finally {
      setBusySpookId(null)
    }
  }

  return (
    <section className="spooks-section">
      <div className="card">
        <div className="spooks-form-header">
          <h2>Spooks</h2>
          <button
            type="button"
            className="spooks-form-toggle"
            onClick={() => setIsFormOpen((open) => !open)}
          >
            {isFormOpen ? 'Close' : '👻 New spook'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className={`spooks-form${isFormOpen ? '' : ' is-hidden'}`}>
          <label htmlFor="spook-caption">Caption</label>
          <textarea
            id="spook-caption"
            value={caption}
            onChange={(event) => {
              setCaption(event.target.value)
              if (error) setError('')
              if (statusMessage) setStatusMessage('')
            }}
            placeholder="Tell the spooky story..."
            rows={4}
          />

          <span className="field-label">Tag users</span>
          <div className="tag-picker" role="group" aria-label="Tag users">
            {users.map((user) => {
              const isSelected = taggedUserIds.includes(user.id)
              return (
                <button
                  key={user.id}
                  type="button"
                  className={`tag-chip${isSelected ? ' is-selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => toggleTaggedUser(user.id)}
                >
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="avatar avatar--sm" />
                  ) : (
                    <span className="avatar avatar--sm avatar--fallback">
                      {user.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span>{user.name}</span>
                </button>
              )
            })}
          </div>

          <label htmlFor="spook-image">Upload image</label>
          <input id="spook-image" type="file" accept="image/*" onChange={handleFileChange} />

          {selectedFile && <div className="muted spooks-selected-file">Selected: {selectedFile.name}</div>}

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {statusMessage && (
            <p role="status" className="form-success">
              {statusMessage}
            </p>
          )}

          <button type="submit" disabled={isUploading}>
            {isUploading ? 'Posting...' : 'Post spook'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Public feed</h3>

        {!isFormOpen && error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!isFormOpen && statusMessage && (
          <p role="status" className="form-success">
            {statusMessage}
          </p>
        )}

        {isLoading ? (
          <p>Loading spooks...</p>
        ) : feed.length === 0 ? (
          <p>No spooks yet. Be the first to post one.</p>
        ) : (
          <div className="spooks-feed">
            {feed.map((spook) => {
              const author = users.find((user) => user.id === spook.user_id)
              const taggedUsers = spook.tagged_user_ids
                .map((userId) => users.find((user) => user.id === userId))
                .filter((user): user is UserSummary => Boolean(user))
              const hasGhost = taggedUsers.length === 0
              const { canEdit, canDelete } = getSpookPermissions(spook, currentUserId, isAdmin)
              const isEditing = editingId === spook.id
              const isBusy = busySpookId === spook.id

              return (
                <article key={spook.id} className="card spook-card">
                  <img
                    className="spook-card-image"
                    src={spook.image_url}
                    alt={spook.caption || 'Spook image'}
                  />

                  <div className="spook-card-body">
                    {isEditing ? (
                      <div className="spook-card-edit">
                        <label htmlFor={`spook-edit-${spook.id}`}>Caption</label>
                        <textarea
                          id={`spook-edit-${spook.id}`}
                          value={editCaption}
                          rows={3}
                          onChange={(event) => setEditCaption(event.target.value)}
                        />
                        <span className="field-label">Tag users</span>
                        <div className="tag-picker" role="group" aria-label="Tag users">
                          {users.map((user) => {
                            const isSelected = editTaggedIds.includes(user.id)
                            return (
                              <button
                                key={user.id}
                                type="button"
                                className={`tag-chip${isSelected ? ' is-selected' : ''}`}
                                aria-pressed={isSelected}
                                onClick={() =>
                                  setEditTaggedIds((current) =>
                                    current.includes(user.id)
                                      ? current.filter((id) => id !== user.id)
                                      : [...current, user.id],
                                  )
                                }
                              >
                                <span>{user.name}</span>
                              </button>
                            )
                          })}
                        </div>
                        {error && (
                          <p role="alert" className="form-error">
                            {error}
                          </p>
                        )}
                        <div className="spook-card-actions">
                          <button type="button" disabled={isBusy} onClick={() => void handleSaveEdit(spook)}>
                            {isBusy ? 'Saving...' : 'Save'}
                          </button>
                          <button type="button" disabled={isBusy} onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="spook-card-caption">{spook.caption}</p>
                    )}

                    <div className="spook-card-author">
                      {author?.avatar_url ? (
                        <img
                          src={author.avatar_url}
                          alt={`${author.name} avatar`}
                          className="avatar avatar--md"
                        />
                      ) : (
                        <span className="avatar avatar--md avatar--fallback">
                          {author?.name?.slice(0, 1).toUpperCase() ?? 'U'}
                        </span>
                      )}
                      <strong>{author?.name ?? 'Unknown spookster'}</strong>
                    </div>

                    <div className="spook-card-tags">
                      <span className="spook-card-tags-label">Tagged:</span>
                      {hasGhost ? (
                        <span className="tag-chip tag-chip--ghost" title="No one was tagged...">
                          <span className="avatar avatar--sm avatar--ghost">👻</span>
                          <em>spooky ghost</em>
                        </span>
                      ) : (
                        taggedUsers.map((user) => (
                          <span key={user.id} className="tag-chip">
                            {user.avatar_url ? (
                              <img src={user.avatar_url} alt="" className="avatar avatar--sm" />
                            ) : (
                              <span className="avatar avatar--sm avatar--fallback">
                                {user.name.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span>{user.name}</span>
                          </span>
                        ))
                      )}
                    </div>

                    <div className="spook-card-time muted">
                      {new Date(spook.created_at).toLocaleString()}
                    </div>

                    {!isEditing && (canEdit || canDelete) && (
                      <div className="spook-card-actions">
                        {canEdit && (
                          <button type="button" disabled={isBusy} onClick={() => startEditing(spook)}>
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" disabled={isBusy} onClick={() => void handleDelete(spook)}>
                            {isBusy ? 'Deleting...' : 'Delete'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
