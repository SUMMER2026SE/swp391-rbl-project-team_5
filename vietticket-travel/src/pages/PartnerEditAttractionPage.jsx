import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

const TABS = ['General Info', 'Location & Map', 'Image Gallery']

const PROVINCES = [
  'Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hội An', 'Nha Trang',
  'Huế', 'Quảng Ninh', 'Phú Quốc', 'Đà Lạt', 'Cần Thơ',
]

const DISTRICTS_MAP = {
  'Đà Nẵng': ['Hải Châu', 'Sơn Trà', 'Ngũ Hành Sơn', 'Liên Chiểu', 'Thanh Khê', 'Hòa Vang'],
  'Hà Nội': ['Hoàn Kiếm', 'Ba Đình', 'Đống Đa', 'Tây Hồ', 'Cầu Giấy'],
  'TP. Hồ Chí Minh': ['Quận 1', 'Quận 3', 'Bình Thạnh', 'Gò Vấp', 'Thủ Đức'],
  'Quảng Ninh': ['Hạ Long', 'Cẩm Phả', 'Uông Bí', 'Móng Cái'],
  'Quảng Nam': ['Hội An', 'Tam Kỳ', 'Điện Bàn'],
  'Khánh Hòa': ['Nha Trang', 'Cam Ranh', 'Ninh Hòa'],
}

// Mock data — sẽ thay bằng API call theo id
const MOCK_DATA = {
  1: { name: 'Sun World Ba Na Hills', description: 'Khu vui chơi giải trí và nghỉ dưỡng nổi tiếng tại Đà Nẵng.', openTime: '08:00', closeTime: '17:00', province: 'Đà Nẵng', district: 'Hòa Vang', address: 'Thôn An Sơn, xã Hòa Ninh, Huyện Hòa Vang', lat: '15.9971', lng: '107.9878', status: 'active' },
  2: { name: 'Vịnh Hạ Long Cruise', description: 'Du thuyền ngắm cảnh vịnh Hạ Long.', openTime: '07:30', closeTime: '18:00', province: 'Quảng Ninh', district: 'Hạ Long', address: 'Cảng Tuần Châu, TP. Hạ Long', lat: '20.9101', lng: '107.1839', status: 'active' },
  3: { name: 'VinWonders Nha Trang', description: 'Công viên giải trí VinWonders tại đảo Hòn Tre.', openTime: '08:00', closeTime: '20:00', province: 'Khánh Hòa', district: 'Nha Trang', address: 'Đảo Hòn Tre, TP. Nha Trang', lat: '12.2104', lng: '109.2521', status: 'inactive' },
  4: { name: 'Hội An Lantern Festival Tour', description: 'Tour tham quan đêm hội đèn lồng Hội An.', openTime: '18:00', closeTime: '22:00', province: 'Quảng Nam', district: 'Hội An', address: 'Phố Cổ Hội An, TP. Hội An', lat: '15.8801', lng: '108.3380', status: 'active' },
}

const MAX_IMAGES = 8
const MAX_FILE_SIZE = 5 * 1024 * 1024

function PartnerEditAttractionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', openTime: '', closeTime: '', province: '', district: '', address: '', lat: '', lng: '', status: 'active' })
  const [images, setImages] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)
  const addMoreRef = useRef(null)
  const descRef = useRef(null)

  useEffect(() => {
    document.title = 'Chỉnh sửa điểm tham quan | VietTicket B2B'
    let active = true
    const applyData = (data) => {
      if (!active) return
      setForm((prev) => ({
        ...prev,
        name: data.name ?? '',
        description: data.description ?? '',
        openTime: data.openTime ?? '',
        closeTime: data.closeTime ?? '',
        province: data.province ?? '',
        district: data.district ?? '',
        address: data.address ?? '',
        lat: data.lat ?? '',
        lng: data.lng ?? '',
        status: data.status ?? 'active',
      }))
      if (descRef.current) descRef.current.innerHTML = data.description || ''
      setIsLoading(false)
    }
    ;(async () => {
      try {
        const res = await partnerApi.getAttraction(id)
        applyData(res.attraction)
      } catch (err) {
        if (partnerApi.isNetworkError(err)) {
          // demo fallback khi không có server
          const data = MOCK_DATA[Number(id)]
          if (!data) {
            if (active) { toast.error('Không tìm thấy điểm tham quan.'); navigate('/partner/attractions') }
            return
          }
          applyData(data)
        } else {
          if (active) { toast.error(err.message); navigate('/partner/attractions') }
        }
      }
    })()
    return () => { active = false }
  }, [id])

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const processFiles = (files) => {
    const valid = Array.from(files).filter((f) => {
      if (!f.type.startsWith('image/')) { toast.error(`"${f.name}" không phải ảnh.`); return false }
      if (f.size > MAX_FILE_SIZE) { toast.error(`"${f.name}" vượt quá 5MB.`); return false }
      return true
    })
    const remaining = MAX_IMAGES - images.length
    const toAdd = valid.slice(0, remaining).map((file, i) => ({ id: `${Date.now()}-${i}`, file, previewUrl: URL.createObjectURL(file), isThumbnail: images.length === 0 && i === 0 }))
    setImages((prev) => [...prev, ...toAdd])
  }

  const handleFileInput = (e) => { processFiles(e.target.files); e.target.value = '' }
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); processFiles(e.dataTransfer.files) }

  const handleDeleteImage = (imgId) => {
    setImages((prev) => {
      const next = prev.filter((img) => img.id !== imgId)
      if (prev.find((img) => img.id === imgId)?.isThumbnail && next.length > 0) next[0] = { ...next[0], isThumbnail: true }
      return next
    })
  }

  const handleSetThumbnail = (imgId) => setImages((prev) => prev.map((img) => ({ ...img, isThumbnail: img.id === imgId })))

  const execCmd = (cmd) => { descRef.current?.focus(); document.execCommand(cmd, false, null) }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Vui lòng nhập tên điểm tham quan.'); setActiveTab(0); return }
    if (!form.province) { toast.error('Vui lòng chọn tỉnh / thành phố.'); setActiveTab(1); return }
    setIsSubmitting(true)

    const payload = {
      name: form.name,
      description: form.description,
      openTime: form.openTime,
      closeTime: form.closeTime,
      province: form.province,
      district: form.district,
      address: form.address,
      lat: form.lat,
      lng: form.lng,
      status: form.status,
    }

    try {
      await partnerApi.updateAttraction(id, payload)
      toast.success('Đã cập nhật điểm tham quan thành công!')
      navigate('/partner/attractions')
    } catch (err) {
      if (partnerApi.isNetworkError(err)) {
        toast.info('Chế độ demo (không có server) — thao tác được mô phỏng.')
        navigate('/partner/attractions')
      } else {
        toast.error(err.message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const districts = DISTRICTS_MAP[form.province] || []

  if (isLoading) return (
    <PartnerLayout pageTitle="Edit Attraction">
      <div className="flex items-center justify-center h-64">
        <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
      </div>
    </PartnerLayout>
  )

  return (
    <PartnerLayout pageTitle="Edit Attraction">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 -mt-2 mb-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/partner/attractions')} className="p-2 rounded-full hover:bg-[#eceeef] transition-colors text-[#3f484a]">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h2 className="text-2xl md:text-3xl font-semibold text-[#191c1d]">Chỉnh sửa điểm tham quan</h2>
            <p className="text-sm text-[#3f484a] mt-0.5">{form.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Status toggle */}
          <button
            onClick={() => updateForm('status', form.status === 'active' ? 'inactive' : 'active')}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${form.status === 'active' ? 'bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]' : 'bg-[#e6e8e9] text-[#3f484a] border-[#bec8ca]'}`}
          >
            <span className="material-symbols-outlined text-[16px] align-middle mr-1">{form.status === 'active' ? 'toggle_on' : 'toggle_off'}</span>
            {form.status === 'active' ? 'Đang hoạt động' : 'Tạm dừng'}
          </button>
          <button onClick={() => navigate('/partner/attractions')} className="px-5 py-2.5 rounded-lg border border-[#6f797a] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors">Hủy</button>
          <button onClick={handleSave} disabled={isSubmitting} className="px-6 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2">
            {isSubmitting && <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>}
            Lưu thay đổi
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 border-b border-[#bec8ca]">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)} className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === i ? 'text-[#00474d] border-b-2 border-[#00474d] -mb-px' : 'text-[#3f484a] hover:text-[#191c1d]'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Form Card */}
      <div className="bg-white rounded-xl shadow-sm border border-[#e1e3e4] p-6 md:p-8 space-y-10">

        {/* Tab 0: General Info */}
        {activeTab === 0 && (
          <section className="space-y-6 animate-fadeIn">
            <SectionHeading>Thông tin chung</SectionHeading>
            <FormField label="Tên điểm tham quan" required>
              <input type="text" value={form.name} onChange={(e) => updateForm('name', e.target.value)} className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] placeholder-[#6f797a] outline-none shadow-sm" />
            </FormField>
            <FormField label="Mô tả">
              <div className="border border-[#bec8ca] rounded-lg overflow-hidden shadow-sm">
                <div className="bg-[#f2f4f5] border-b border-[#bec8ca] px-4 py-2 flex items-center gap-1">
                  {[{ cmd: 'bold', icon: 'format_bold' }, { cmd: 'italic', icon: 'format_italic' }, { cmd: 'underline', icon: 'format_underlined' }].map(({ cmd, icon }) => (
                    <button key={cmd} type="button" onMouseDown={(e) => { e.preventDefault(); execCmd(cmd) }} className="p-1.5 rounded hover:bg-[#e1e3e4] text-[#3f484a]">
                      <span className="material-symbols-outlined text-[20px]">{icon}</span>
                    </button>
                  ))}
                  <div className="w-px bg-[#bec8ca] mx-1 h-5" />
                  {[{ cmd: 'insertUnorderedList', icon: 'format_list_bulleted' }, { cmd: 'insertOrderedList', icon: 'format_list_numbered' }].map(({ cmd, icon }) => (
                    <button key={cmd} type="button" onMouseDown={(e) => { e.preventDefault(); execCmd(cmd) }} className="p-1.5 rounded hover:bg-[#e1e3e4] text-[#3f484a]">
                      <span className="material-symbols-outlined text-[20px]">{icon}</span>
                    </button>
                  ))}
                </div>
                <div ref={descRef} contentEditable suppressContentEditableWarning onInput={(e) => updateForm('description', e.currentTarget.innerHTML)} className="w-full min-h-[120px] px-4 py-3 text-sm text-[#191c1d] outline-none" />
              </div>
            </FormField>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="Giờ mở cửa">
                <TimeInput value={form.openTime} onChange={(v) => updateForm('openTime', v)} />
              </FormField>
              <FormField label="Giờ đóng cửa">
                <TimeInput value={form.closeTime} onChange={(v) => updateForm('closeTime', v)} />
              </FormField>
            </div>
            <TabNav onNext={() => setActiveTab(1)} />
          </section>
        )}

        {/* Tab 1: Location */}
        {activeTab === 1 && (
          <section className="space-y-6 animate-fadeIn">
            <SectionHeading>Thông tin địa điểm</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField label="Tỉnh / Thành phố" required>
                <select value={form.province} onChange={(e) => { updateForm('province', e.target.value); updateForm('district', '') }} className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm">
                  <option value="">Chọn tỉnh / thành phố</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </FormField>
              <FormField label="Quận / Huyện">
                <select value={form.district} onChange={(e) => updateForm('district', e.target.value)} disabled={!form.province || districts.length === 0} className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm disabled:opacity-50">
                  <option value="">Chọn quận / huyện</option>
                  {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="Địa chỉ chi tiết">
              <input type="text" value={form.address} onChange={(e) => updateForm('address', e.target.value)} className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm" />
            </FormField>
            <FormField label="Vị trí trên bản đồ">
              <MapPlaceholder lat={form.lat} lng={form.lng} />
            </FormField>
            <TabNav onBack={() => setActiveTab(0)} onNext={() => setActiveTab(2)} />
          </section>
        )}

        {/* Tab 2: Gallery */}
        {activeTab === 2 && (
          <section className="space-y-6 animate-fadeIn">
            <SectionHeading>Thư viện ảnh</SectionHeading>
            <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleFileInput} />
            <input ref={addMoreRef} type="file" multiple accept="image/*" className="hidden" onChange={handleFileInput} />
            <div onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-colors cursor-pointer group ${isDragging ? 'border-[#00474d] bg-[#f2f4f5]' : 'border-[#bec8ca] bg-[#f8fafb] hover:bg-[#f2f4f5]'}`}>
              <div className="w-16 h-16 bg-[#006068] rounded-full flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-white text-[32px]">cloud_upload</span>
              </div>
              <h4 className="text-sm font-medium text-[#191c1d] mb-1">{isDragging ? 'Thả ảnh vào đây' : 'Nhấp để tải lên hoặc kéo thả'}</h4>
              <p className="text-sm text-[#3f484a]">PNG, JPG, GIF (tối đa 5MB, tối đa {MAX_IMAGES} ảnh)</p>
              {images.length > 0 && <p className="mt-2 text-xs font-medium text-[#00474d]">{images.length}/{MAX_IMAGES} ảnh đã tải lên</p>}
            </div>
            {images.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {images.map((img) => (
                  <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-[#bec8ca] shadow-sm group">
                    <img src={img.previewUrl} alt="Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    {img.isThumbnail && (
                      <div className="absolute top-2 left-2 bg-white/90 px-2 py-1 rounded flex items-center gap-1 shadow-sm">
                        <span className="material-symbols-outlined text-[#ffba20] text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                        <span className="text-xs font-semibold text-[#191c1d]">Thumbnail</span>
                      </div>
                    )}
                    {!img.isThumbnail && (
                      <button onClick={() => handleSetThumbnail(img.id)} className="absolute top-2 left-2 bg-white/90 px-2 py-1 rounded flex items-center gap-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity text-[#3f484a] hover:text-[#00474d]">
                        <span className="material-symbols-outlined text-[14px]">star</span>
                        <span className="text-xs font-medium">Đặt TN</span>
                      </button>
                    )}
                    <button onClick={() => handleDeleteImage(img.id)} className="absolute top-2 right-2 w-7 h-7 bg-[#ba1a1a]/90 hover:bg-[#ba1a1a] rounded-full flex items-center justify-center text-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))}
                {images.length < MAX_IMAGES && (
                  <div onClick={() => addMoreRef.current?.click()} className="relative aspect-square rounded-lg border-2 border-dashed border-[#bec8ca] flex flex-col items-center justify-center bg-[#f8fafb] hover:bg-[#f2f4f5] transition-colors cursor-pointer text-[#3f484a] hover:text-[#00474d] hover:border-[#00474d]">
                    <span className="material-symbols-outlined text-[32px] mb-1">add_photo_alternate</span>
                    <span className="text-xs font-semibold">Thêm ảnh</span>
                  </div>
                )}
              </div>
            )}
            <TabNav onBack={() => setActiveTab(1)} isLast onPublish={handleSave} isSubmitting={isSubmitting} publishLabel="Lưu thay đổi" />
          </section>
        )}
      </div>
      <div className="h-8" />
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.animate-fadeIn{animation:fadeIn 0.25s ease-out forwards}`}</style>
    </PartnerLayout>
  )
}

function SectionHeading({ children }) {
  return <h3 className="text-lg font-semibold text-[#191c1d] border-b border-[#e1e3e4] pb-2">{children}</h3>
}

function FormField({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#191c1d] mb-2">{label}{required && <span className="text-[#ba1a1a] ml-1">*</span>}</label>
      {children}
    </div>
  )
}

function TimeInput({ value, onChange }) {
  return (
    <div className="relative">
      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#00629d] text-[20px] pointer-events-none">schedule</span>
      <input type="time" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] pl-10 pr-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm" />
    </div>
  )
}

function MapPlaceholder({ lat, lng }) {
  return (
    <div className="w-full h-[260px] rounded-xl overflow-hidden relative border border-[#bec8ca] shadow-sm bg-[#e1e3e4]">
      <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBM_qQYAkdTgQl8cSHBtcGqQsM-qoAJfHtfr3xTly5bnnbM2oVmWlpk2fgLnS9ulabLT7FjDiTezR_1muqWfE9-HlQAmVla58ik7qJeYyud8m99ssn09VJOJ1hCZPprMZbQYS7TAjXkKsZ6C4Qyc3P6jfyI_Exm7M_Tlf5SnYpU646T50QYFsy6OuectoO_efcQQ69eIpJgyWLDqX1L4Q4-eIs4aAP7N7zrTnVJyxFxJcLkeMrNKDcjuUhYiAd-0XVIEB5rqQILhPw" alt="Map" className="w-full h-full object-cover opacity-60" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full drop-shadow-md">
        <span className="material-symbols-outlined text-[#ba1a1a] text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
      </div>
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-md border border-[#bec8ca] shadow-sm flex items-center gap-2">
        <span className="material-symbols-outlined text-[#6f797a] text-[16px]">my_location</span>
        <span className="text-xs font-semibold text-[#191c1d]">Lat: {lat}, Lng: {lng}</span>
      </div>
    </div>
  )
}

function TabNav({ onBack, onNext, isLast = false, onPublish, isSubmitting = false, publishLabel = 'Lưu thay đổi' }) {
  return (
    <div className="flex justify-between pt-4 border-t border-[#f2f4f5]">
      {onBack ? (
        <button type="button" onClick={onBack} className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#6f797a] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>Quay lại
        </button>
      ) : <div />}
      {isLast ? (
        <button type="button" onClick={onPublish} disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60">
          {isSubmitting ? <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">save</span>}
          {publishLabel}
        </button>
      ) : (
        <button type="button" onClick={onNext} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm">
          Tiếp theo<span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      )}
    </div>
  )
}

export default PartnerEditAttractionPage
