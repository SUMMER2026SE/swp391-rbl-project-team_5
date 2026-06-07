import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

// Mock data — thay bằng API call
const MOCK_ATTRACTION_NAMES = { 1: 'Sun World Ba Na Hills', 2: 'Vịnh Hạ Long Cruise', 3: 'VinWonders Nha Trang', 4: 'Hội An Lantern Festival Tour' }

const MOCK_TICKETS = {
  1: [
    { id: 't1', name: 'Vé người lớn', type: 'ADULT', originalPrice: 900000, sellingPrice: 850000, refundPolicy: 'PARTIAL', status: 'active' },
    { id: 't2', name: 'Vé trẻ em (dưới 12 tuổi)', type: 'CHILD', originalPrice: 600000, sellingPrice: 550000, refundPolicy: 'FULL', status: 'active' },
    { id: 't3', name: 'Vé gia đình (2 người lớn + 2 trẻ em)', type: 'FAMILY', originalPrice: 2800000, sellingPrice: 2500000, refundPolicy: 'NONE', status: 'inactive' },
  ],
  2: [
    { id: 't4', name: 'Vé du thuyền 1 ngày', type: 'ADULT', originalPrice: 1200000, sellingPrice: 1100000, refundPolicy: 'PARTIAL', status: 'active' },
  ],
  3: [],
  4: [
    { id: 't5', name: 'Vé tham quan đêm', type: 'ADULT', originalPrice: 150000, sellingPrice: 120000, refundPolicy: 'FULL', status: 'active' },
  ],
}

const TYPE_LABEL = { ADULT: 'Người lớn', CHILD: 'Trẻ em', FAMILY: 'Gia đình', GROUP: 'Nhóm' }
const TYPE_COLOR = { ADULT: 'bg-[#cfe5ff] text-[#003558]', CHILD: 'bg-[#ffdea8] text-[#271900]', FAMILY: 'bg-[#E6F4EA] text-[#137333]', GROUP: 'bg-[#ffdad6] text-[#93000a]' }
const REFUND_LABEL = { NONE: 'Không hoàn', PARTIAL: 'Hoàn 1 phần', FULL: 'Hoàn toàn bộ' }
const REFUND_COLOR = { NONE: 'text-[#ba1a1a]', PARTIAL: 'text-[#725000]', FULL: 'text-[#137333]' }

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)
}

function PartnerTicketsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [attractionName, setAttractionName] = useState('')
  const [tickets, setTickets] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState(null) // ticket to confirm delete

  useEffect(() => {
    document.title = 'Quản lý Gói vé | VietTicket B2B'
    let active = true
    setIsLoading(true)
    ;(async () => {
      try {
        const data = await partnerApi.listTickets(id)
        if (!active) return
        setAttractionName(data.attraction?.name || MOCK_ATTRACTION_NAMES[Number(id)] || 'Điểm tham quan')
        setTickets(data.tickets)
      } catch (err) {
        if (!active) return
        if (partnerApi.isNetworkError(err)) {
          // Fallback demo khi không có server
          setAttractionName(MOCK_ATTRACTION_NAMES[Number(id)] || 'Điểm tham quan')
          setTickets(MOCK_TICKETS[Number(id)] || [])
        } else {
          toast.error(err.message)
        }
      } finally {
        if (active) setIsLoading(false)
      }
    })()
    return () => { active = false }
  }, [id])

  const handleDelete = async (ticketId) => {
    try {
      await partnerApi.deleteTicket(ticketId)
      setTickets((prev) => prev.filter((t) => t.id !== ticketId))
      setDeleteTarget(null)
      toast.success('Đã xóa gói vé.')
    } catch (err) {
      if (partnerApi.isNetworkError(err)) {
        setTickets((prev) => prev.filter((t) => t.id !== ticketId))
        setDeleteTarget(null)
        toast.info('Chế độ demo (không có server) — thao tác được mô phỏng.')
      } else {
        toast.error(err.message)
      }
    }
  }

  const handleToggleStatus = (ticketId) => {
    setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: t.status === 'active' ? 'inactive' : 'active' } : t))
  }

  const discount = (orig, sell) => Math.round((1 - sell / orig) * 100)

  return (
    <PartnerLayout pageTitle="Ticket Management">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 -mt-2 mb-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/partner/attractions')} className="p-2 rounded-full hover:bg-[#eceeef] transition-colors text-[#3f484a]">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h2 className="text-2xl font-semibold text-[#191c1d]">Quản lý Gói vé</h2>
            <p className="text-sm text-[#3f484a] mt-0.5 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">local_activity</span>
              {attractionName}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link
            to={`/partner/attractions/${id}/schedule`}
            className="px-4 py-2.5 rounded-lg border border-[#bec8ca] text-[#3f484a] text-sm font-medium hover:bg-[#f2f4f5] transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            Cấu hình lịch
          </Link>
          <button
            onClick={() => navigate(`/partner/attractions/${id}/tickets/new`)}
            className="px-5 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Thêm gói vé
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState onAdd={() => navigate(`/partner/attractions/${id}/tickets/new`)} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Tổng gói vé', value: tickets.length, icon: 'confirmation_number', color: 'text-[#00474d]' },
              { label: 'Đang hoạt động', value: tickets.filter((t) => t.status === 'active').length, icon: 'check_circle', color: 'text-[#137333]' },
              { label: 'Tạm dừng', value: tickets.filter((t) => t.status === 'inactive').length, icon: 'pause_circle', color: 'text-[#ba1a1a]' },
              { label: 'Giá thấp nhất', value: formatVND(Math.min(...tickets.map((t) => t.sellingPrice))), icon: 'sell', color: 'text-[#00629d]' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl border border-[#e1e3e4] p-4 flex items-center gap-3 shadow-sm">
                <span className={`material-symbols-outlined text-[24px] ${stat.color}`}>{stat.icon}</span>
                <div>
                  <p className="text-xs text-[#3f484a]">{stat.label}</p>
                  <p className="text-base font-bold text-[#191c1d]">{stat.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Ticket Cards */}
          <div className="flex flex-col gap-3">
            {tickets.map((ticket) => (
              <div key={ticket.id} className={`bg-white rounded-xl border shadow-sm p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-opacity ${ticket.status === 'inactive' ? 'opacity-60' : 'border-[#e1e3e4]'}`}>
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-[#f2f4f5] flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-[#00474d] text-[20px]">confirmation_number</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-[#191c1d]">{ticket.name}</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLOR[ticket.type]}`}>{TYPE_LABEL[ticket.type]}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-[#3f484a]">Gốc:</span>
                        <span className="text-xs text-[#6f797a] line-through">{formatVND(ticket.originalPrice)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-[#3f484a]">Bán:</span>
                        <span className="text-sm font-bold text-[#00474d]">{formatVND(ticket.sellingPrice)}</span>
                        <span className="text-xs font-semibold text-white bg-[#ba1a1a] px-1.5 py-0.5 rounded">
                          -{discount(ticket.originalPrice, ticket.sellingPrice)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px] text-[#6f797a]">policy</span>
                        <span className={`text-xs font-medium ${REFUND_COLOR[ticket.refundPolicy]}`}>{REFUND_LABEL[ticket.refundPolicy]}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggleStatus(ticket.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${ticket.status === 'active' ? 'bg-[#E6F4EA] text-[#137333] border-[#CEEAD6] hover:bg-[#CEEAD6]' : 'bg-[#e6e8e9] text-[#3f484a] border-[#bec8ca] hover:bg-[#d8dadb]'}`}
                  >
                    {ticket.status === 'active' ? 'Hoạt động' : 'Tạm dừng'}
                  </button>
                  <button onClick={() => navigate(`/partner/attractions/${id}/tickets/${ticket.id}/edit`)} className="p-2 rounded-lg text-[#3f484a] hover:text-[#00629d] hover:bg-[#eceeef] transition-colors" title="Chỉnh sửa">
                    <span className="material-symbols-outlined text-[20px]">edit</span>
                  </button>
                  <button onClick={() => setDeleteTarget(ticket)} className="p-2 rounded-lg text-[#3f484a] hover:text-[#ba1a1a] hover:bg-[#ffdad6] transition-colors" title="Xóa">
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#ffdad6] flex items-center justify-center">
                <span className="material-symbols-outlined text-[#ba1a1a]">delete</span>
              </div>
              <h3 className="text-base font-bold text-[#191c1d]">Xóa gói vé</h3>
            </div>
            <p className="text-sm text-[#3f484a] mb-6">
              Bạn có chắc muốn xóa gói vé <strong>"{deleteTarget.name}"</strong>? Thao tác này không thể hoàn tác.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg border border-[#bec8ca] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors">Hủy</button>
              <button onClick={() => handleDelete(deleteTarget.id)} className="px-4 py-2 rounded-lg bg-[#ba1a1a] text-white text-sm font-medium hover:bg-[#93000a] transition-colors">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-16 h-16 rounded-full bg-[#f2f4f5] flex items-center justify-center">
        <span className="material-symbols-outlined text-[32px] text-[#bec8ca]">confirmation_number</span>
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-[#191c1d]">Chưa có gói vé nào</p>
        <p className="text-sm text-[#3f484a] mt-1">Tạo gói vé đầu tiên để bắt đầu nhận đặt chỗ.</p>
      </div>
      <button onClick={onAdd} className="px-5 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px]">add</span>
        Thêm gói vé
      </button>
    </div>
  )
}

export default PartnerTicketsPage
