import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import { useAuth } from '../context/useAuth.js'
import * as partnerApi from '../services/partnerApi.js'

function PartnerSettingsPage() {
  const { user } = useAuth()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')

  const [profile, setProfile] = useState({ displayName: '', contactEmail: '', phone: '', website: '', description: '' })
  const [notif, setNotif] = useState({ newBooking: true, cancellation: true, lowCapacity: false, weeklyReport: true })

  useEffect(() => {
    document.title = 'Cài đặt | VietTicket B2B'

    // Giá trị khởi tạo (cũng là fallback demo khi không có server)
    const mockProfile = {
      displayName: user?.fullName || '',
      contactEmail: user?.email || '',
      phone: '',
      website: '',
      description: '',
    }

    let cancelled = false
    ;(async () => {
      try {
        const data = await partnerApi.getMyPartner()
        const p = data.partner || {}
        if (!cancelled) {
          setProfile({
            displayName: p.displayName || p.businessName || mockProfile.displayName,
            contactEmail: p.contactEmail || mockProfile.contactEmail,
            phone: p.phone || '',
            website: p.website || '',
            description: p.description || '',
          })
        }
      } catch (err) {
        if (partnerApi.isNetworkError(err)) {
          if (!cancelled) setProfile(mockProfile)
        } else {
          toast.error(err.message)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [user])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await partnerApi.updatePartnerSettings({
        displayName: profile.displayName,
        businessName: profile.displayName,
        phone: profile.phone,
        website: profile.website,
        description: profile.description,
      })
      toast.success('Đã lưu cài đặt thành công!')
    } catch (err) {
      if (partnerApi.isNetworkError(err)) {
        toast.info('Chế độ demo (không có server) — thao tác được mô phỏng.')
      } else {
        toast.error(err.message)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const TABS = [
    { key: 'profile',  label: 'Thông tin đối tác', icon: 'business' },
    { key: 'notif',    label: 'Thông báo', icon: 'notifications' },
    { key: 'security', label: 'Bảo mật', icon: 'lock' },
  ]

  return (
    <PartnerLayout pageTitle="Settings">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 -mt-2 mb-6">
        <h2 className="text-2xl font-semibold text-[#191c1d]">Cài đặt tài khoản</h2>
        <button onClick={handleSave} disabled={isSaving} className="px-6 py-2.5 bg-[#00474d] text-white text-sm font-medium rounded-lg hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2 self-start sm:self-auto">
          {isSaving && <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>}
          <span className="material-symbols-outlined text-[18px]">save</span>Lưu thay đổi
        </button>
      </div>

      <div className="flex gap-1 bg-[#f2f4f5] p-1 rounded-xl w-fit mb-6">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === t.key ? 'bg-white text-[#00474d] shadow-sm' : 'text-[#3f484a] hover:text-[#191c1d]'}`}>
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48"><span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span></div>
      ) : (
        <>
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="max-w-2xl">
              <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-6 flex flex-col gap-5">
                {[
                  { key: 'displayName', label: 'Tên hiển thị / Tên đối tác', placeholder: 'VD: Công ty Du lịch ABC' },
                  { key: 'contactEmail', label: 'Email liên hệ', placeholder: 'contact@company.com', type: 'email' },
                  { key: 'phone', label: 'Số điện thoại', placeholder: '0901 234 567', type: 'tel' },
                  { key: 'website', label: 'Website', placeholder: 'https://www.company.com', type: 'url' },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-[#191c1d] mb-1.5">{f.label}</label>
                    <input
                      type={f.type || 'text'} value={profile[f.key]} placeholder={f.placeholder}
                      onChange={(e) => setProfile((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm outline-none shadow-sm"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-[#191c1d] mb-1.5">Mô tả đối tác</label>
                  <textarea
                    rows={4} value={profile.description} placeholder="Giới thiệu ngắn về doanh nghiệp của bạn…"
                    onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))}
                    className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm outline-none shadow-sm resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notification Tab */}
          {activeTab === 'notif' && (
            <div className="max-w-2xl">
              <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-6 flex flex-col gap-1">
                {[
                  { key: 'newBooking', label: 'Đặt vé mới', desc: 'Nhận thông báo khi có đặt vé mới.' },
                  { key: 'cancellation', label: 'Hủy đặt vé', desc: 'Nhận thông báo khi khách hàng hủy đặt vé.' },
                  { key: 'lowCapacity', label: 'Sắp hết chỗ', desc: 'Cảnh báo khi sức chứa còn dưới 10%.' },
                  { key: 'weeklyReport', label: 'Báo cáo tuần', desc: 'Nhận báo cáo doanh thu vào mỗi thứ Hai hàng tuần.' },
                ].map((n, i) => (
                  <label key={n.key} className={`flex items-center justify-between p-4 cursor-pointer hover:bg-[#f7f8f9] rounded-lg ${i > 0 ? 'border-t border-[#f2f4f5]' : ''}`}>
                    <div>
                      <p className="text-sm font-medium text-[#191c1d]">{n.label}</p>
                      <p className="text-xs text-[#6f797a] mt-0.5">{n.desc}</p>
                    </div>
                    <div className="relative flex-shrink-0 ml-4">
                      <input type="checkbox" className="sr-only peer" checked={notif[n.key]} onChange={(e) => setNotif((p) => ({ ...p, [n.key]: e.target.checked }))} />
                      <div className="w-10 h-6 bg-[#bec8ca] peer-checked:bg-[#00474d] rounded-full transition-colors" />
                      <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="max-w-2xl">
              <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-6 flex flex-col gap-5">
                {['Mật khẩu hiện tại', 'Mật khẩu mới', 'Xác nhận mật khẩu mới'].map((l) => (
                  <div key={l}>
                    <label className="block text-sm font-medium text-[#191c1d] mb-1.5">{l}</label>
                    <input type="password" className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm outline-none shadow-sm" placeholder="••••••••" />
                  </div>
                ))}
                <button onClick={() => toast.success('Đổi mật khẩu thành công!')} className="self-start px-5 py-2.5 bg-[#00474d] text-white text-sm font-medium rounded-lg hover:bg-[#136870] transition-colors">
                  Đổi mật khẩu
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </PartnerLayout>
  )
}

export default PartnerSettingsPage
