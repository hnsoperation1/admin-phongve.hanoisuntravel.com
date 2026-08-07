'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Search, Users, UserRound, Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

type GroupRow = { zalo_group_id: string; zalo_group_name: string | null; synced_at: string }
type ContactRow = { zalo_user_id: string; display_name: string | null; zalo_name: string | null; phone_number: string | null; synced_at: string }

// Chỉ để XEM nhóm/bạn bè của TÀI KHOẢN ZALO BẠN TỰ ĐĂNG NHẬP — worker/
// (Railway) đồng bộ định kỳ vào zalo_groups/zalo_contacts (xem
// worker/index.js syncGroups()/syncContacts()), lọc theo user_id của
// chính người đang xem (mỗi nhân viên 1 tài khoản Zalo riêng, xem
// migration_zalo_session_per_user.sql) — không sửa/xoá gì ở đây, dữ liệu
// tự cập nhật ở lần đồng bộ kế tiếp. Nhóm còn dùng để chọn người nhận ở
// trang "Lịch gửi tin Zalo"; danh bạ hiện chưa dùng ở đâu khác.
//
// Không còn khoá riêng super_admin như trước nữa — lúc đó là 1 bot Zalo
// chung cho cả team nên phải hạn chế ai xem được danh bạ (SĐT cá nhân);
// giờ mỗi người chỉ thấy đúng dữ liệu của tài khoản Zalo họ tự đăng nhập
// (API /api/zalo-contacts đã lọc theo user_id), requirePhongVe() (mọi
// người có quyền vào app) là đủ.
export default function DanhMucZaloPage() {
  const [tab, setTab] = useState<'groups' | 'contacts'>('groups')
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [gRes, cRes] = await Promise.all([fetch('/api/zalo-groups'), fetch('/api/zalo-contacts')])
      if (!gRes.ok || !cRes.ok) throw new Error('load failed')
      const [{ data: g }, { data: c }] = await Promise.all([gRes.json(), cRes.json()])
      setGroups(Array.isArray(g) ? g : [])
      setContacts(Array.isArray(c) ? c : [])
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

  // Báo worker (Railway) đồng bộ ngay thay vì chờ tới lượt định kỳ (mặc
  // định 5 phút) — worker poll cờ này mỗi ~4s (xem checkSyncRequest() ở
  // worker/index.js), nên đợi 6s rồi tự tải lại là đủ để thấy kết quả mới.
  async function requestSync() {
    setSyncing(true)
    try {
      await fetch('/api/zalo-sync-request', { method: 'POST' })
      await new Promise(r => setTimeout(r, 6000))
      await loadData()
    } finally {
      setSyncing(false)
    }
  }

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => (g.zalo_group_name ?? '').toLowerCase().includes(q) || g.zalo_group_id.includes(q))
  }, [groups, search])

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(c =>
      (c.display_name ?? '').toLowerCase().includes(q) ||
      (c.zalo_name ?? '').toLowerCase().includes(q) ||
      (c.phone_number ?? '').includes(q),
    )
  }, [contacts, search])

  const lastSynced = useMemo(() => {
    const rows = tab === 'groups' ? groups : contacts
    if (rows.length === 0) return null
    return rows.reduce((latest, r) => (r.synced_at > latest ? r.synced_at : latest), rows[0].synced_at)
  }, [tab, groups, contacts])

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Danh mục Zalo</h1>
          <p className="text-sm text-gray-400 mt-0.5">Nhóm và bạn bè của tài khoản Zalo bạn đã đăng nhập — worker (Railway) tự đồng bộ định kỳ, chỉ xem, không sửa được ở đây.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Tải lại từ dữ liệu đã đồng bộ">
            <RefreshCw size={16} />
          </button>
          <button onClick={requestSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
            title="Báo worker đồng bộ ngay với Zalo thay vì chờ tới lượt định kỳ (~5 phút)">
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Đồng bộ ngay
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setTab('groups')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
            tab === 'groups' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}>
          <Users size={14} /> Nhóm ({groups.length})
        </button>
        <button onClick={() => setTab('contacts')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
            tab === 'contacts' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}>
          <UserRound size={14} /> Bạn bè ({contacts.length})
        </button>

        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm tên, SĐT, ID..."
            className="pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 w-64" />
        </div>
      </div>

      {lastSynced && (
        <p className="text-xs text-gray-400">Đồng bộ gần nhất lúc {formatDateTime(lastSynced)}</p>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {(tab === 'groups' ? ['Tên nhóm', 'Group ID', 'Đồng bộ lúc'] : ['Tên hiển thị', 'Tên Zalo', 'SĐT', 'Đồng bộ lúc']).map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-gray-300">Đang tải...</td></tr>
              ) : loadError ? (
                <tr><td colSpan={4} className="px-5 py-14 text-center">
                  <p className="text-gray-400 mb-2">Không tải được dữ liệu, có thể do lỗi mạng.</p>
                  <button onClick={loadData} className="text-xs font-semibold text-brand-600 hover:text-brand-700 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors">Thử lại</button>
                </td></tr>
              ) : tab === 'groups' ? (
                filteredGroups.length === 0 ? (
                  <tr><td colSpan={3} className="px-5 py-14 text-center text-gray-400">
                    {groups.length === 0 ? 'Chưa có nhóm nào — worker cần đăng nhập Zalo và đồng bộ trước.' : 'Không có nhóm nào khớp tìm kiếm.'}
                  </td></tr>
                ) : filteredGroups.map(g => (
                  <tr key={g.zalo_group_id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-4 py-2.5 text-gray-800 font-medium">{g.zalo_group_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{g.zalo_group_id}</td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{formatDateTime(g.synced_at)}</td>
                  </tr>
                ))
              ) : (
                filteredContacts.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-14 text-center text-gray-400">
                    {contacts.length === 0 ? 'Chưa có liên hệ nào — worker cần đăng nhập Zalo và đồng bộ trước.' : 'Không có liên hệ nào khớp tìm kiếm.'}
                  </td></tr>
                ) : filteredContacts.map(c => (
                  <tr key={c.zalo_user_id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-4 py-2.5 text-gray-800 font-medium">{c.display_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{c.zalo_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{c.phone_number ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{formatDateTime(c.synced_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
