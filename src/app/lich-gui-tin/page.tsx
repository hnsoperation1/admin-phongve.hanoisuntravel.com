'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Plus, Loader2, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

type ScheduledMessage = {
  id: string
  title: string
  message: string
  zalo_group_id: string
  zalo_group_name: string | null
  run_at: string
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly'
  status: 'pending' | 'sent' | 'error' | 'cancelled'
  last_error: string | null
  last_sent_at: string | null
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Hàng ngày', weekly: 'Hàng tuần', monthly: 'Hàng tháng', once: 'Chỉ 1 lần',
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-blue-50 text-blue-700',
  sent: 'bg-emerald-50 text-emerald-700',
  error: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Chờ gửi', sent: 'Đã gửi', error: 'Lỗi', cancelled: 'Đã huỷ',
}

const INPUT = 'w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white placeholder:text-gray-300'

// Ngày + giờ (input date/time riêng, không phải datetime-local) dùng giờ
// local — new Date(str) ở trình duyệt tự hiểu theo local time,
// .toISOString() ra đúng UTC để lưu DB.
function dateTimeToIso(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null
  const d = new Date(`${dateStr}T${timeStr}`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

type GroupRef = { id: string; name: string | null }

export default function LichGuiTinPage() {
  const [jobs, setJobs] = useState<ScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [date, setDate] = useState('')
  const [times, setTimes] = useState<string[]>([''])
  const [recurrence, setRecurrence] = useState('daily')
  const [selectedGroups, setSelectedGroups] = useState<GroupRef[]>([])
  const [knownGroups, setKnownGroups] = useState<GroupRef[]>([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)

  // Danh sách nhóm CHỈ lấy từ đồng bộ thật với Zalo (worker/index.js
  // syncGroups(), xem BRIEF-railway-vs-vercel.md) — không cho gõ tay Thread
  // ID nữa, vì nhóm phải tồn tại thật trên Zalo mới gửi tin được, gõ tay dễ
  // sai/không kiểm chứng được.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetch('/api/zalo-groups')
      .then(res => res.json())
      .then(({ data }) => {
        if (Array.isArray(data)) {
          setKnownGroups(data.map((g: { zalo_group_id: string; zalo_group_name: string | null }) => ({ id: g.zalo_group_id, name: g.zalo_group_name })))
        }
      })
      .finally(() => setGroupsLoaded(true))
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/lich-gui-tin')
      if (!res.ok) throw new Error('load failed')
      const { data } = await res.json()
      setJobs(Array.isArray(data) ? data : [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [loadData])

  function openAdd() {
    setTitle('')
    setMessage('')
    setDate('')
    setTimes([''])
    setRecurrence('daily')
    setSelectedGroups([])
    setFormOpen(true)
  }

  function addTime() {
    setTimes(prev => [...prev, ''])
  }

  function removeTime(i: number) {
    setTimes(prev => prev.filter((_, idx) => idx !== i))
  }

  function setTimeAt(i: number, v: string) {
    setTimes(prev => prev.map((t, idx) => (idx === i ? v : t)))
  }

  function toggleGroup(g: GroupRef) {
    setSelectedGroups(prev => (prev.some(x => x.id === g.id) ? prev.filter(x => x.id !== g.id) : [...prev, g]))
  }

  // Mỗi (giờ chạy × nhóm đã chọn) là 1 job riêng — worker chỉ hiểu 1
  // run_at/1 nhóm mỗi dòng, nên "nhiều giờ trong ngày" + "nhiều nhóm" được
  // hiện thực bằng cách tạo nhiều dòng cùng lúc từ 1 lần lưu form.
  async function save() {
    const validTimes = times.map(t => t.trim()).filter(Boolean)
    if (!title.trim() || !message.trim() || !date || validTimes.length === 0 || selectedGroups.length === 0) return
    setSaving(true)
    try {
      for (const t of validTimes) {
        const iso = dateTimeToIso(date, t)
        if (!iso) continue
        for (const g of selectedGroups) {
          await fetch('/api/lich-gui-tin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.trim(),
              message,
              zalo_group_id: g.id,
              zalo_group_name: g.name,
              run_at: iso,
              recurrence,
            }),
          })
        }
      }
      setFormOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/lich-gui-tin/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    loadData()
  }

  async function remove(id: string) {
    await fetch(`/api/lich-gui-tin/${id}`, { method: 'DELETE' })
    loadData()
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Lịch gửi tin Zalo</h1>
          <p className="text-sm text-gray-400 mt-0.5">Cài đặt tin nhắn gửi tự động vào nhóm Zalo theo giờ/ngày cụ thể.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors">
            <Plus size={15} /> Thêm lịch
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="fixed inset-y-0 left-52 right-0 z-50 flex justify-end bg-black/30" onClick={() => setFormOpen(false)}>
          <div className="bg-white shadow-xl w-full h-full p-5 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-gray-900 mb-3">Thêm lịch gửi tin</h2>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Ngày chạy *</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className={INPUT} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Giờ chạy *</label>
                  <div className="space-y-2">
                    {times.map((t, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input type="time" value={t} onChange={e => setTimeAt(i, e.target.value)} className={INPUT} />
                        {times.length > 1 && (
                          <button type="button" onClick={() => removeTime(i)} className="p-2 text-gray-300 hover:text-red-500 transition-colors">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addTime} className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                    <Plus size={13} /> Thêm giờ chạy
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Lặp lại</label>
                  <select value={recurrence} onChange={e => setRecurrence(e.target.value)} className={INPUT}>
                    {Object.entries(RECURRENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div className="col-span-2 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Tiêu đề *</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} className={INPUT} placeholder="Nhắc lịch bay sáng" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Nội dung tin nhắn *</label>
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={10} className={INPUT} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Gửi vào nhóm *</label>
                <div className="border border-gray-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-gray-100">
                  {!groupsLoaded ? (
                    <p className="text-xs text-gray-300 px-3 py-3">Đang tải danh sách nhóm...</p>
                  ) : knownGroups.length === 0 ? (
                    <p className="text-xs text-gray-300 px-3 py-3">
                      Chưa có nhóm nào — worker (Railway) cần đăng nhập Zalo và đồng bộ trước, xem trang &quot;Đăng nhập lại Zalo&quot;.
                    </p>
                  ) : knownGroups.map(g => (
                    <label key={g.id} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selectedGroups.some(x => x.id === g.id)} onChange={() => toggleGroup(g)} />
                      <span className="truncate">{g.name ?? g.id}</span>
                    </label>
                  ))}
                </div>

                {selectedGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedGroups.map(g => (
                      <span key={g.id} className="flex items-center gap-1 text-[11px] bg-brand-50 text-brand-700 px-2 py-1 rounded-full">
                        {g.name ?? g.id}
                        <button type="button" onClick={() => toggleGroup(g)}><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button onClick={() => setFormOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors">Huỷ</button>
              <button onClick={save}
                disabled={saving || !title.trim() || !message.trim() || !date || times.every(t => !t.trim()) || selectedGroups.length === 0}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />} Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Tiêu đề', 'Nhóm', 'Chạy lúc', 'Lặp lại', 'Trạng thái', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-300">Đang tải...</td></tr>
              ) : loadError ? (
                <tr><td colSpan={6} className="px-5 py-14 text-center">
                  <p className="text-gray-400 mb-2">Không tải được dữ liệu, có thể do lỗi mạng.</p>
                  <button onClick={loadData} className="text-xs font-semibold text-brand-600 hover:text-brand-700 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors">Thử lại</button>
                </td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-14 text-center text-gray-400">Chưa có lịch gửi tin nào.</td></tr>
              ) : jobs.map(j => (
                <tr key={j.id} className="hover:bg-gray-50/70 transition-colors align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-800">{j.title}</div>
                    <div className="text-xs text-gray-400 truncate max-w-xs">{j.message}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{j.zalo_group_name ?? j.zalo_group_id}</td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatDateTime(j.run_at)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{RECURRENCE_LABELS[j.recurrence] ?? j.recurrence}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[j.status] ?? ''}`}>
                      {STATUS_LABELS[j.status] ?? j.status}
                    </span>
                    {j.status === 'error' && j.last_error && (
                      <div className="text-[11px] text-red-500 mt-1 max-w-[200px] truncate" title={j.last_error}>{j.last_error}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {j.status === 'error' && (
                      <button onClick={() => updateStatus(j.id, 'pending')} className="text-xs font-semibold text-brand-600 hover:text-brand-700 mr-3">Thử lại</button>
                    )}
                    {j.status === 'pending' && (
                      <button onClick={() => updateStatus(j.id, 'cancelled')} className="text-xs font-semibold text-gray-400 hover:text-gray-600 mr-3">Huỷ</button>
                    )}
                    <button onClick={() => remove(j.id)} className="text-xs font-semibold text-red-400 hover:text-red-600">Xoá</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
