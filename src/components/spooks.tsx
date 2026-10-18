import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { sortSpooksByNewest, type SpookRecord } from '../utils/spooks'

type UserSummary = {
  id: string
  name: string
  avatar_url: string | null
}

type SpooksProps = {
  currentUserId: string
  users: UserSummary[]
}

export function Spooks({ currentUserId, users }: SpooksProps) {
  const [feed, setFeed] = useState<SpookRecord[]>([])
  const [caption, setCaption] = useState('')
  const [taggedUserId, setTaggedUserId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  const loadFeed = async () => {
    setIsLoading(true)
    setError('')

    const { data, error: feedError } = await supabase
      .from('spooks')
      .select('*')
      .order('created_at', { ascending: false })

    if (feedError) {
      console.error('Failed to load spooks:', feedError)
      setError('Could not load the spook feed right now.')
      setFeed([])
      setIsLoading(false)
      return
    }

    setFeed(sortSpooksByNewest((data ?? []) as SpookRecord[]))
    setIsLoading(false)
  }

  useEffect(() => {
    void loadFeed()
  }, [])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    if (error) {
      setError('')
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
          tagged_user_id: taggedUserId || null,
        })
        .select()
        .single()

      if (insertError) {
        throw insertError
      }

      const nextSpook = insertedSpook as SpookRecord
      setFeed((currentFeed) => sortSpooksByNewest([nextSpook, ...currentFeed]))
      setCaption('')
      setTaggedUserId('')
      setSelectedFile(null)
      setStatusMessage('Spook posted successfully.')
      const fileInput = document.getElementById('spook-image') as HTMLInputElement | null
      if (fileInput) {
        fileInput.value = ''
      }
    } catch (submitError) {
      console.error('Failed to create spook:', submitError)
      setError('Your spook could not be posted. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section style={{ maxWidth: '760px', margin: '0 auto', display: 'grid', gap: '1.25rem' }}>
      <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem', display: 'grid', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>Spooks</h2>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.8rem' }}>
          <label htmlFor="spook-caption" style={{ fontWeight: 600 }}>
            Caption
          </label>
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
            style={{ padding: '0.75rem', resize: 'vertical' }}
          />

          <label htmlFor="spook-tagged-user" style={{ fontWeight: 600 }}>
            Tag another user
          </label>
          <select
            id="spook-tagged-user"
            value={taggedUserId}
            onChange={(event) => setTaggedUserId(event.target.value)}
            style={{ padding: '0.6rem 0.75rem' }}
          >
            <option value="">No tag</option>
            {users
              .filter((user) => user.id !== currentUserId)
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
          </select>

          <label htmlFor="spook-image" style={{ fontWeight: 600 }}>
            Upload image
          </label>
          <input id="spook-image" type="file" accept="image/*" onChange={handleFileChange} />

          {selectedFile && (
            <div style={{ color: '#ddd', fontSize: '0.9rem' }}>
              Selected: {selectedFile.name}
            </div>
          )}

          {error && <p role="alert" style={{ margin: 0, color: '#ffb4b4' }}>{error}</p>}
          {statusMessage && <p role="status" style={{ margin: 0, color: '#b7f7c7' }}>{statusMessage}</p>}

          <button type="submit" disabled={isUploading}>
            {isUploading ? 'Posting...' : 'Post spook'}
          </button>
        </form>
      </div>

      <div style={{ border: '1px solid #2a2a2a', borderRadius: '12px', padding: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Public feed</h3>

        {isLoading ? (
          <p>Loading spooks...</p>
        ) : feed.length === 0 ? (
          <p>No spooks yet. Be the first to post one.</p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {feed.map((spook) => {
              const author = users.find((user) => user.id === spook.user_id)
              const taggedUser = users.find((user) => user.id === spook.tagged_user_id)

              return (
                <article
                  key={spook.id}
                  style={{
                    border: '1px solid #2a2a2a',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    background: '#171717',
                  }}
                >
                  <img
                    src={spook.image_url}
                    alt={spook.caption || 'Spook image'}
                    style={{ display: 'block', width: '100%', maxHeight: '420px', objectFit: 'cover' }}
                  />

                  <div style={{ padding: '0.9rem', display: 'grid', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {author?.avatar_url ? (
                        <img
                          src={author.avatar_url}
                          alt={`${author.name} avatar`}
                          style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: '#3d3d3d',
                            display: 'grid',
                            placeItems: 'center',
                            color: '#fff',
                            fontSize: '0.7rem',
                          }}
                        >
                          {author?.name?.slice(0, 1).toUpperCase() ?? 'U'}
                        </div>
                      )}

                      <strong>{author?.name ?? 'Unknown spookster'}</strong>
                    </div>

                    <p style={{ margin: 0, lineHeight: 1.6 }}>{spook.caption}</p>

                    {taggedUser && (
                      <div style={{ color: '#d7d7d7', fontSize: '0.9rem' }}>
                        Tagged: <strong>{taggedUser.name}</strong>
                      </div>
                    )}

                    <div style={{ color: '#a6a6a6', fontSize: '0.8rem' }}>
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
