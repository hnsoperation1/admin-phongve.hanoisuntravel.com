'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { QrCode, Loader2, XCircle, RefreshCw } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

type SessionState = {
  status: 'idle' | 'requested' | 'in_progress' | 'qr_ready' | 'scanned' | 'done' | 'revoked' | 'expired' | 'declined' | 'error'
  qr_image: string | null
  error_message: string | null
  requested_at: string | null
  updated_at: string
}

// Đang trong luồng đăng nhập — poll nhanh (2s) để cập nhật QR/kết quả kịp
// thời; các trạng thái "nghỉ" (idle/done/lỗi) không cần poll dồn dập.
const ACTIVE_STATUSES = ['requested', 'in_progress', 'qr_ready', 'scanned']

// Cố ý KHÔNG có icon/màu "thành công vĩnh viễn" cho status='done' — trạng
// thái đó chỉ có nghĩa "lần quét QR gần nhất đã thành công", KHÔNG đảm bảo
// phiên vẫn còn sống (Zalo có thể ngắt bất cứ lúc nào nếu tài khoản đăng
// nhập ở nơi khác — lúc đó worker tự chuyển sang 'revoked').
const STATUS_LABEL: Record<string, string> = {
  idle: 'Chưa đăng nhập lần nào',
  requested: 'Đang gửi yêu cầu tới worker...',
  in_progress: 'Worker đang khởi tạo mã QR...',
  qr_ready: 'Quét mã QR bên dưới bằng app Zalo trên điện thoại',
  scanned: 'Đã quét — xác nhận đăng nhập trên điện thoại...',
  done: 'Đã đăng nhập — lần quét QR gần nhất thành công',
  revoked: 'Tài khoản đã đăng nhập ở nơi khác — phiên này bị ngắt, cần đăng nhập lại',
  expired: 'Mã QR đã hết hạn (~100 giây)',
  declined: 'Đã từ chối đăng nhập trên điện thoại',
  error: 'Có lỗi xảy ra',
}

export default function ZaloSessionPage() {
  const [state, setState] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/zalo-session')
      if (!res.ok) return
      const { data } = await res.json()
      setState(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const active = state ? ACTIVE_STATUSES.includes(state.status) : false
    timerRef.current = setTimeout(load, active ? 2000 : 8000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [state, load])

  async function requestLogin() {
    setRequesting(true)
    try {
      const res = await fetch('/api/zalo-session', { method: 'POST' })
      if (res.ok) {
        const { data } = await res.json()
        setState(data)
      }
    } finally {
      setRequesting(false)
    }
  }

  const status = state?.status ?? 'idle'
  const canRequest = !requesting && status !== 'requested' && status !== 'in_progress' && status !== 'qr_ready' && status !== 'scanned'

  return (
    <div className="p-5 space-y-4 max-w-lg">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Đăng nhập lại Zalo</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center text-center gap-4">
        {loading ? (
          <Loader2 size={24} className="animate-spin text-gray-300" />
        ) : status === 'qr_ready' && state?.qr_image ? (
          <img
            src={`data:image/png;base64,${state.qr_image}`}
            alt="QR đăng nhập Zalo"
            className="w-56 h-56 rounded-xl border border-gray-100"
          />
        ) : status === 'error' || status === 'revoked' || status === 'expired' || status === 'declined' ? (
          <XCircle size={40} className="text-red-400" />
        ) : status === 'requested' || status === 'in_progress' || status === 'scanned' ? (
          <Loader2 size={32} className="animate-spin text-brand-500" />
        ) : (
          <QrCode size={40} className="text-gray-300" />
        )}

        <div>
          <p className="text-sm font-medium text-gray-700">{STATUS_LABEL[status] ?? status}</p>
          {(status === 'error' || status === 'revoked') && state?.error_message && (
            <p className="text-xs text-red-500 mt-1 break-words">{state.error_message}</p>
          )}
          {state?.updated_at && (
            <p className="text-[11px] text-gray-300 mt-1">Cập nhật lúc {formatDateTime(state.updated_at)}</p>
          )}
        </div>

        <button
          onClick={requestLogin}
          disabled={!canRequest}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {requesting ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Đăng nhập lại Zalo
        </button>
      </div>
    </div>
  )
}
