import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { normalizeSpookRow, sortSpooksByNewest, type SpookRecord } from '../utils/spooks'
import './spooks.css'

type UserSummary = {
  id: string
  name: string
  avatar_url: string | null
}

type SpooksProps = {
  currentUserId: string
  users: UserSummary[]
}

type SpookRow = Omit<SpookRecord, 'tagged_user_ids'> & {
  spook_tagged_users: { user_id: string }[] | null
}

export function Spooks({ currentUserId, users }: SpooksProps) {
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

              return (
                <article key={spook.id} className="card spook-card">
                  <img
                    className="spook-card-image"
                    src={spook.image_url}
                    alt={spook.caption || 'Spook image'}
                  />

                  <div className="spook-card-body">
                    <p className="spook-card-caption">{spook.caption}</p>

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
