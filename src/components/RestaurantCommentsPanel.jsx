import { useEffect, useState } from 'react'
import { Flag, PencilSimple, Plus, Trash, Translate } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'

const MAX_COMMENT_LENGTH = 200

function formatCommentDate(value) {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

function errorMessage(error) {
  const message = String(error?.message || '')
  if (message.includes('one comment per restaurant per day')) {
    return '이 식당에는 오늘 이미 한마디를 남겼어요.'
  }
  if (message.includes('inappropriate language')) {
    return '비속어나 부적절한 표현은 사용할 수 없어요.'
  }
  if (message.includes('username is required')) {
    return '먼저 설정에서 닉네임을 만들어 주세요.'
  }
  return '댓글을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

export function RestaurantCommentsPanel({ restaurantId, userId, username, canComment, isAdmin }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [editingComment, setEditingComment] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [translations, setTranslations] = useState({})

  const loadComments = async () => {
    if (!restaurantId) return
    const { data, error: loadError } = await supabase
      .from('restaurant_comments')
      .select('id, user_id, username, is_anonymous, body, created_at, updated_at')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (loadError) setError('댓글을 불러오지 못했어요.')
    else setComments(data || [])
    setLoading(false)
  }

  useEffect(() => {
    setComments([])
    setLoading(true)
    setComposerOpen(false)
    setEditingComment(null)
    setBody('')
    setError('')
    loadComments()

    if (!restaurantId) return undefined
    const channel = supabase
      .channel(`restaurant-comments-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurant_comments', filter: `restaurant_id=eq.${restaurantId}` },
        loadComments,
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [restaurantId])

  const openNewComment = () => {
    setError('')
    setEditingComment(null)
    setBody('')
    setAnonymous(false)
    setComposerOpen(true)
  }

  const openEdit = (comment) => {
    setError('')
    setEditingComment(comment)
    setBody(comment.body)
    setAnonymous(comment.is_anonymous)
    setComposerOpen(true)
  }

  const saveComment = async (event) => {
    event.preventDefault()
    const trimmedBody = body.trim()
    if (!trimmedBody || !userId) return
    setSaving(true)
    setError('')
    const payload = { body: trimmedBody, is_anonymous: anonymous }
    const result = editingComment
      ? await supabase.from('restaurant_comments').update(payload).eq('id', editingComment.id)
      : await supabase.from('restaurant_comments').insert({
          ...payload,
          restaurant_id: restaurantId,
          user_id: userId,
          username: username || '',
        })
    setSaving(false)
    if (result.error) {
      setError(errorMessage(result.error))
      return
    }
    setComposerOpen(false)
    setBody('')
    setEditingComment(null)
    loadComments()
  }

  const deleteComment = async (commentId) => {
    if (!window.confirm('이 댓글을 삭제할까요?')) return
    const { error: deleteError } = await supabase
      .from('restaurant_comments')
      .delete()
      .eq('id', commentId)
    if (deleteError) setError('댓글을 삭제하지 못했어요.')
    else loadComments()
  }

  const translateComment = async (commentId) => {
    const targetLanguage = (navigator.language || 'en').split('-')[0]
    setError('')
    const { data, error: translateError } = await supabase.functions.invoke('translate-comment', {
      body: { commentId, targetLanguage },
    })
    if (translateError || !data?.translation) setError('번역하지 못했어요. 잠시 후 다시 시도해 주세요.')
    else setTranslations((current) => ({ ...current, [commentId]: data.translation }))
  }

  const reportComment = async (commentId) => {
    if (!userId || !window.confirm('이 리뷰를 신고할까요?')) return
    const { error: reportError } = await supabase
      .from('restaurant_comment_reports')
      .insert({ comment_id: commentId, reporter_id: userId })
    if (reportError?.code === '23505') setError('이미 신고한 리뷰예요.')
    else if (reportError) setError('신고하지 못했어요.')
    else setError('리뷰가 신고되었습니다.')
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col py-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-500">리뷰 노트</p>
          <p className="mt-0.5 text-[10px] text-gray-400">최근 10개 · 네덜란드 시간 기준 하루 1개</p>
        </div>
        <button
          type="button"
          onClick={openNewComment}
          disabled={!userId || !canComment}
          className="flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          <Plus size={13} weight="bold" /> 한마디
        </button>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
        onTouchStart={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
      >
        {loading ? (
          <p className="py-8 text-center text-xs text-gray-400">불러오는 중...</p>
        ) : comments.length === 0 ? (
          <p className="py-8 text-center text-xs text-gray-400">첫 번째 한마디를 남겨 보세요.</p>
        ) : comments.map((comment) => {
          const isMine = comment.user_id === userId
          return (
            <article key={comment.id} className="rounded-xl bg-white px-3 py-2 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-semibold text-gray-700">
                  {comment.is_anonymous ? '익명' : comment.username}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400">{formatCommentDate(comment.created_at)}</span>
                  {isMine && (
                    <>
                      <button type="button" aria-label="댓글 수정" onClick={() => openEdit(comment)} className="text-gray-400"><PencilSimple size={13} /></button>
                      <button type="button" aria-label="댓글 삭제" onClick={() => deleteComment(comment.id)} className="text-gray-400"><Trash size={13} /></button>
                    </>
                  )}
                  {!isMine && userId && <button type="button" aria-label="리뷰 신고" onClick={() => reportComment(comment.id)} className="text-gray-400"><Flag size={13} /></button>}
                  {isAdmin && <button type="button" aria-label="관리자 삭제" onClick={() => deleteComment(comment.id)} className="text-red-400"><Trash size={13} /></button>}
                </div>
              </div>
              <p className="mt-1 break-words text-xs leading-relaxed text-gray-600">{comment.body}</p>
              {translations[comment.id] ? (
                <p className="mt-1 break-words border-t border-gray-100 pt-1 text-xs leading-relaxed text-gray-500">{translations[comment.id]}</p>
              ) : (
                <button type="button" onClick={() => translateComment(comment.id)} className="mt-1 flex items-center gap-1 text-[10px] text-orange-500"><Translate size={12} /> 번역하기</button>
              )}
            </article>
          )
        })}
      </div>

      {error && <p className="mt-2 text-center text-[11px] text-red-500">{error}</p>}
      {!canComment && userId && (
        <p className="mt-2 text-center text-[11px] text-gray-400">활성 멤버만 한마디를 남길 수 있어요.</p>
      )}

      {composerOpen && (
        <div className="absolute inset-0 z-20 flex items-end bg-black/20" onTouchStart={(event) => event.stopPropagation()}>
          <form onSubmit={saveComment} className="w-full rounded-t-2xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">{editingComment ? '리뷰 수정' : '리뷰 남기기'}</p>
              <button type="button" onClick={() => setComposerOpen(false)} className="text-xs text-gray-400">닫기</button>
            </div>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={MAX_COMMENT_LENGTH}
              rows={3}
              autoFocus
              placeholder="식당에 대한 짧은 한마디를 남겨 주세요"
              className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-orange-400"
            />
            <div className="mt-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> 익명으로 표시
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-400">{body.length}/{MAX_COMMENT_LENGTH}</span>
                <button type="submit" disabled={saving || !body.trim()} className="rounded-full bg-orange-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  {saving ? '저장 중' : '등록'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
