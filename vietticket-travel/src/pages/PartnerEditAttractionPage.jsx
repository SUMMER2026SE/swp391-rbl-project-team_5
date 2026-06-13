import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import CoordinateFields from '../components/partner/CoordinateFields.jsx'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

const TABS = ['Thông tin chung', 'Bản đồ & Vị trí', 'Thư viện ảnh']

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

const MAX_IMAGES = 8
const MAX_FILE_SIZE = 5 * 1024 * 1024

function PartnerEditAttractionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    openTime: '',
    closeTime: '',
    province: '',
    district: '',
    address: '',
    lat: '',
    lng: '',
    status: 'active',
    dbStatus: 'DRAFT',
    rejectionReason: null,
    category: '',
  })
  const [categories, setCategories] = useState([])
  const [images, setImages] = useState([])
  const [deletedImageIds, setDeletedImageIds] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)
  const addMoreRef = useRef(null)

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
        dbStatus: data.dbStatus ?? 'DRAFT',
        rejectionReason: data.rejectionReason ?? null,
        category: data.category ?? '',
      }))
      if (Array.isArray(data.images)) {
        setImages(
          data.images.map((img) => ({
            id: img.id,
            previewUrl: img.url,
            file: null,
            isThumbnail: img.isPrimary,
          })),
        )
      }
      setIsLoading(false)
    }
    ;(async () => {
      try {
        const [attractionResponse, categoryResponse] = await Promise.all([
          partnerApi.getAttraction(id),
          partnerApi.getCategories(),
        ])
        if (active) setCategories(categoryResponse.categories || [])
        applyData(attractionResponse.attraction)
      } catch (err) {
        if (active) { toast.error(err.message); navigate('/partner/attractions') }
      }
    })()
    return () => { active = false }
  }, [id, navigate])

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
    const deleted = images.find((img) => img.id === imgId)
    if (deleted && !deleted.file) {
      setDeletedImageIds((current) => [...current, deleted.id])
    } else if (deleted?.previewUrl) {
      URL.revokeObjectURL(deleted.previewUrl)
    }
    setImages((prev) => {
      const next = prev.filter((img) => img.id !== imgId)
      if (deleted?.isThumbnail && next.length > 0) next[0] = { ...next[0], isThumbnail: true }
      return next
    })
  }

  const handleSetThumbnail = (imgId) => setImages((prev) => prev.map((img) => ({ ...img, isThumbnail: img.id === imgId })))

  const handleSave = async ({ submitForReview = false } = {}) => {
    if (!form.name.trim()) { toast.error('Vui lòng nhập tên điểm tham quan.'); setActiveTab(0); return }
    if (!form.address.trim()) { toast.error('Vui lòng nhập địa chỉ chi tiết.'); setActiveTab(1); return }
    if (!form.province) { toast.error('Vui lòng chọn tỉnh / thành phố.'); setActiveTab(1); return }
    if (!form.category) { toast.error('Vui lòng chọn danh mục điểm tham quan.'); setActiveTab(0); return }
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
      category: form.category,
    }

    try {
      await partnerApi.updateAttraction(id, payload)

      for (const imageId of deletedImageIds) {
        await partnerApi.deleteAttractionImage(id, imageId)
      }

      const newFiles = images.map((img) => img.file).filter(Boolean)
      let uploadResponse
      if (newFiles.length > 0) {
        uploadResponse = await partnerApi.uploadAttractionImages(id, newFiles)
      }

      const primaryImage = images.find((image) => image.isThumbnail)
      let primaryImageId = primaryImage?.id
      if (primaryImage?.file) {
        const newFileIndex = newFiles.indexOf(primaryImage.file)
        primaryImageId = uploadResponse?.images?.[newFileIndex]?.id
      }
      if (primaryImageId) {
        await partnerApi.setAttractionPrimaryImage(id, primaryImageId)
      }

      if (submitForReview) {
        await partnerApi.submitAttraction(id)
        toast.success('Đã lưu thay đổi và gửi điểm tham quan để phê duyệt!')
      } else {
        toast.success('Đã cập nhật điểm tham quan thành công!')
      }
      navigate('/partner/attractions')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const districts = DISTRICTS_MAP[form.province] || []
  const canSubmitForReview = form.dbStatus === 'DRAFT' || form.dbStatus === 'REJECTED'

  if (isLoading) return (
    <PartnerLayout pageTitle="Edit Attraction">
      <div className="flex items-center justify-center h-64">
        <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
      </div>
    </PartnerLayout>
  )

  return (
    <PartnerLayout pageTitle="Edit Attraction">
      {/* Title block */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold text-[#191c1d]">Chỉnh sửa điểm tham quan</h2>
          <p className="text-base text-[#3f484a] mt-1">Cập nhật thông tin chi tiết cho điểm trải nghiệm của bạn.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-stretch sm:self-auto justify-end">
          <button
            onClick={() => updateForm('status', form.status === 'active' ? 'inactive' : 'active')}
            className={`px-4 py-2.5 rounded-lg text-xs font-semibold border transition-all flex items-center ${form.status === 'active' ? 'bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]' : 'bg-[#e6e8e9] text-[#3f484a] border-[#bec8ca]'}`}
          >
            <span className="material-symbols-outlined text-[16px] align-middle mr-1">{form.status === 'active' ? 'toggle_on' : 'toggle_off'}</span>
            {form.status === 'active' ? 'Đang hoạt động' : 'Tạm dừng'}
          </button>
          <button onClick={() => navigate('/partner/attractions')} className="px-5 py-2.5 rounded-lg border border-[#bec8ca] text-[#191c1d] text-sm font-semibold hover:bg-[#f2f4f5] transition-colors">Hủy</button>
          <button onClick={() => handleSave({ submitForReview: false })} disabled={isSubmitting} className="px-5 py-2.5 rounded-lg border border-[#00474d] text-[#00474d] text-sm font-semibold hover:bg-[#e0f4f5] transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2">
            Lưu thay đổi
          </button>
          {canSubmitForReview && (
            <button onClick={() => handleSave({ submitForReview: true })} disabled={isSubmitting} className="px-5 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-semibold hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2">
              {isSubmitting && <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>}
              Lưu & Gửi duyệt
            </button>
          )}
        </div>
      </div>

      {/* Banner cảnh báo của Admin */}
      {form.dbStatus === 'REJECTED' && (
        <div className="bg-[#ffdad6] text-[#ba1a1a] border border-[#ffb4ab] rounded-xl p-4 flex gap-3 items-start mb-6 animate-fadeIn">
          <span className="material-symbols-outlined text-[22px] flex-shrink-0 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
          <div>
            <p className="font-bold text-sm">Điểm tham quan này đã bị Admin từ chối phê duyệt</p>
            <p className="text-xs mt-1 leading-relaxed">
              <strong>Lý do từ chối:</strong> {form.rejectionReason || 'Vui lòng liên hệ bộ phận hỗ trợ đối tác để biết thêm chi tiết.'}
            </p>
            <p className="text-xs mt-2 italic font-medium">
              Vui lòng cập nhật hoặc sửa đổi các thông tin không phù hợp theo lý do trên, sau đó bấm nút "Lưu & Gửi duyệt" để gửi yêu cầu phê duyệt lại cho Admin.
            </p>
          </div>
        </div>
      )}

      {form.dbStatus === 'SUSPENDED' && (
        <div className="bg-[#ffdad6] text-[#ba1a1a] border border-[#ffb4ab] rounded-xl p-4 flex gap-3 items-start mb-6 animate-fadeIn">
          <span className="material-symbols-outlined text-[22px] flex-shrink-0 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>report</span>
          <div>
            <p className="font-bold text-sm">Điểm tham quan này đang bị đình chỉ hoạt động</p>
            <p className="text-xs mt-1 leading-relaxed">
              <strong>Lý do đình chỉ (vi phạm):</strong> {form.rejectionReason || 'Vui lòng kiểm tra lại điều khoản dịch vụ.'}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-8 border-b border-[#bec8ca] mb-6">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)} className={`pb-4 text-sm font-semibold transition-colors relative ${activeTab === i ? 'text-[#00474d] border-b-2 border-[#00474d] -mb-px' : 'text-[#3f484a] hover:text-[#191c1d]'}`}>
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
            <FormField label="Danh mục" required>
              <select value={form.category} onChange={(e) => updateForm('category', e.target.value)} className="w-full rounded-lg border border-[#bec8ca] bg-white px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d]">
                <option value="">Chọn danh mục</option>
                {categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
              </select>
            </FormField>
            <FormField label="Mô tả">
              <textarea
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="Mô tả trải nghiệm, điểm nổi bật và thông tin hữu ích cho du khách."
                className="w-full resize-y rounded-lg border border-[#bec8ca] bg-white px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d]"
              />
              <p className="mt-1 text-right text-xs text-[#6f797a]">
                {form.description.length}/5000 ký tự
              </p>
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
            <FormField label="Địa chỉ chi tiết" required>
              <input type="text" value={form.address} onChange={(e) => updateForm('address', e.target.value)} className="w-full rounded-lg border border-[#bec8ca] bg-white focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm text-[#191c1d] outline-none shadow-sm" />
            </FormField>
            <FormField label="Tọa độ bản đồ">
              <CoordinateFields
                lat={form.lat}
                lng={form.lng}
                onLatChange={(value) => updateForm('lat', value)}
                onLngChange={(value) => updateForm('lng', value)}
              />
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
              <h4 className="text-sm font-bold text-[#191c1d] mb-1">{isDragging ? 'Thả ảnh vào đây' : 'Nhấp để tải lên hoặc kéo thả'}</h4>
              <p className="text-sm text-[#3f484a]">PNG, JPG, GIF (tối đa 5MB, tối đa {MAX_IMAGES} ảnh)</p>
              {images.length > 0 && <p className="mt-2 text-xs font-semibold text-[#00474d]">{images.length}/{MAX_IMAGES} ảnh đã tải lên</p>}
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
            <TabNav
              onBack={() => setActiveTab(1)}
              isLast
              onPublish={() => handleSave({ submitForReview: false })}
              onPublishAndSubmit={() => handleSave({ submitForReview: true })}
              showSubmitForReview={canSubmitForReview}
              isSubmitting={isSubmitting}
              publishLabel="Lưu thay đổi"
            />
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
      <label className="block text-sm font-semibold text-[#191c1d] mb-2">{label}{required && <span className="text-[#ba1a1a] ml-1">*</span>}</label>
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

function TabNav({ onBack, onNext, isLast = false, onPublish, onPublishAndSubmit, showSubmitForReview = false, isSubmitting = false, publishLabel = 'Lưu thay đổi' }) {
  return (
    <div className="flex justify-between pt-4 border-t border-[#f2f4f5] gap-2">
      {onBack ? (
        <button type="button" onClick={onBack} className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#6f797a] text-[#191c1d] text-sm font-semibold hover:bg-[#f2f4f5] transition-colors">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>Quay lại
        </button>
      ) : <div />}
      <div className="flex gap-2">
        {isLast ? (
          <>
            <button type="button" onClick={onPublish} disabled={isSubmitting} className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#bec8ca] text-[#3f484a] text-sm font-semibold hover:bg-[#f2f4f5] transition-colors disabled:opacity-60">
              {publishLabel}
            </button>
            {showSubmitForReview && (
              <button type="button" onClick={onPublishAndSubmit} disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-semibold hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60">
                {isSubmitting ? <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">publish</span>}
                Lưu & Gửi duyệt
              </button>
            )}
          </>
        ) : (
          <button type="button" onClick={onNext} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-semibold hover:bg-[#136870] transition-colors shadow-sm">
            Tiếp theo<span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        )}
      </div>
    </div>
  )
}

export default PartnerEditAttractionPage
