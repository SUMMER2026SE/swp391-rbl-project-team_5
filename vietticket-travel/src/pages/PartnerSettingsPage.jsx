import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
  useEffect(() => {
    document.title = 'Cài đặt | VietTicket B2B'

    const accountProfile = {
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
            displayName: p.displayName || p.businessName || accountProfile.displayName,
            contactEmail: p.contactEmail || accountProfile.contactEmail,
            phone: p.phone || '',
            website: p.website || '',
            description: p.description || '',
          })
        }
      } catch (err) {
        if (!cancelled) setProfile(accountProfile)
        toast.error(err.message)
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
      toast.error(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const TABS = [
    { key: 'profile',  label: 'Thông tin đối tác', icon: 'business' },
    { key: 'security', label: 'Bảo mật', icon: 'lock' },
  ]

  return (
    <PartnerLayout pageTitle="Settings">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 -mt-2 mb-6">
        <h2 className="text-2xl font-semibold text-[#191c1d]">Cài đặt tài khoản</h2>
        {activeTab === 'profile' && (
          <button onClick={handleSave} disabled={isSaving} className="px-6 py-2.5 bg-[#00474d] text-white text-sm font-medium rounded-lg hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2 self-start sm:self-auto">
            {isSaving && <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>}
            <span className="material-symbols-outlined text-[18px]">save</span>Lưu thay đổi
          </button>
        )}
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

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="max-w-2xl">
              <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-6">
                <h3 className="text-base font-semibold text-[#191c1d]">Mật khẩu tài khoản</h3>
                <p className="text-sm text-[#6f797a] mt-2 mb-5">
                  Việc đổi mật khẩu yêu cầu xác minh mật khẩu hiện tại và được xử lý qua luồng bảo mật chung.
                </p>
                <Link to="/change-password" className="inline-flex px-5 py-2.5 bg-[#00474d] text-white text-sm font-medium rounded-lg hover:bg-[#136870] transition-colors">
                  Mở trang đổi mật khẩu
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </PartnerLayout>
  )
}

export default PartnerSettingsPage
