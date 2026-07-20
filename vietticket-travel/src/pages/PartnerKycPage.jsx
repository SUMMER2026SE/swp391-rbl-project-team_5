import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../context/useAuth.js'
import * as partnerApi from '../services/partnerApi.js'

// Danh sách một số ngân hàng phổ biến tại Việt Nam
const popularBanks = [
  'Vietcombank (Ngân hàng TMCP Ngoại thương Việt Nam)',
  'Techcombank (Ngân hàng TMCP Kỹ thương Việt Nam)',
  'BIDV (Ngân hàng TMCP Đầu tư và Phát triển Việt Nam)',
  'VietinBank (Ngân hàng TMCP Công thương Việt Nam)',
  'Agribank (Ngân hàng Nông nghiệp & Phát triển Nông thôn)',
  'MB Bank (Ngân hàng TMCP Quân đội)',
  'VPBank (Ngân hàng TMCP Việt Nam Thịnh Vượng)',
  'ACB (Ngân hàng TMCP Á Châu)',
  'TPBank (Ngân hàng TMCP Tiên Phong)',
  'Sacombank (Ngân hàng TMCP Sài Gòn Thương Tín)',
  'HDBank (Ngân hàng TMCP Phát triển TP.HCM)',
  'VIB (Ngân hàng Quốc tế)',
  'SHB (Ngân hàng TMCP Sài Gòn - Hà Nội)',
  'MSB (Ngân hàng TMCP Hàng Hải Việt Nam)',
  'SeABank (Ngân hàng TMCP Đông Nam Á)'
]

function PartnerKycPage() {
  const navigate = useNavigate()
  const { user, getProfile, logout } = useAuth()
  const bankDropdownRef = useRef(null)

  // Các bước form: 1 (Doanh nghiệp), 2 (Tài chính), 3 (Pháp lý)
  const [step, setStep] = useState(1)
  
  // Dữ liệu biểu mẫu
  const [formData, setFormData] = useState({
    // Step 1: Doanh nghiệp
    businessName: '',
    taxCode: '',
    registrationDate: '',
    representativeName: '',
    representativePhone: '',
    businessAddress: '',
    // Step 2: Tài chính
    bankName: '',
    branchName: '',
    bankAccountNumber: '',
    bankAccountName: '',
    swiftCode: '',
    payoutCurrency: 'VND',
    // Step 3: Pháp lý
    businessLicenseUrl: '',
  })

  // Trạng thái tìm kiếm/dropdown cho ngân hàng
  const [showBankDropdown, setShowBankDropdown] = useState(false)
  const [bankSearch, setBankSearch] = useState('')

  // Trạng thái touched để hiển thị lỗi validation
  const [touched, setTouched] = useState({})
  // Trạng thái tải lên tệp
  const [uploading, setUploading] = useState(false)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [partnerProfile, setPartnerProfile] = useState(null)
  const [isProfileLoading, setIsProfileLoading] = useState(true)

  // Đóng dropdown ngân hàng khi click ra ngoài
  useEffect(() => {
    function handleClickOutside(event) {
      if (bankDropdownRef.current && !bankDropdownRef.current.contains(event.target)) {
        setShowBankDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  useEffect(() => {
    document.title = 'Xác thực Đối tác & Hồ sơ Doanh nghiệp | VietTicket Travel'
    
    if (!user) {
      toast.info('Vui lòng đăng nhập để thực hiện xác thực đối tác.')
      navigate('/login', { state: { from: { pathname: '/partner/kyc' } } })
      return
    }

    let active = true
    partnerApi
      .getMyPartner()
      .then((res) => {
        if (!active) return
        const p = res.partner
        if (p) {
          setPartnerProfile(p)
          setFormData({
            businessName: p.businessName || '',
            taxCode: p.taxCode || '',
            registrationDate: p.registrationDate || '',
            representativeName: p.representativeName || '',
            representativePhone: p.representativePhone || '',
            businessAddress: p.businessAddress || '',
            bankName: p.bankName || '',
            branchName: p.branchName || '',
            bankAccountNumber: p.bankAccountNumber || '',
            bankAccountName: p.bankAccountName || '',
            swiftCode: p.swiftCode || '',
            payoutCurrency: p.payoutCurrency || 'VND',
            businessLicenseUrl: p.businessLicenseUrl || '',
          })
          if (p.bankName) {
            setBankSearch(p.bankName)
          }
          if (p.businessLicenseUrl) {
            setUploadedFile({
              name: 'Giấy phép kinh doanh đã tải lên',
              size: null,
            })
          }
        }
      })
      .catch(() => {
        // Ignored: profile not created yet is normal
      })
      .finally(() => {
        if (active) setIsProfileLoading(false)
      })

    return () => {
      active = false
    }
  }, [user, navigate])

  // Trình kiểm tra lỗi cho từng trường
  const getErrors = () => {
    const errs = {}
    
    if (step === 1) {
      if (!formData.businessName.trim()) errs.businessName = 'Tên doanh nghiệp không được để trống.'
      if (!formData.taxCode.trim()) {
        errs.taxCode = 'Mã số thuế không được để trống.'
      } else if (!/^\d{10}(\d{3})?$/.test(formData.taxCode.trim())) {
        errs.taxCode = 'Mã số thuế phải gồm 10 hoặc 13 chữ số.'
      }
      if (!formData.registrationDate) errs.registrationDate = 'Vui lòng chọn ngày đăng ký kinh doanh.'
      if (!formData.representativeName.trim()) errs.representativeName = 'Tên người đại diện không được để trống.'
      if (!formData.representativePhone.trim()) {
        errs.representativePhone = 'Số điện thoại không được để trống.'
      } else if (!/^0[35789][0-9]{8}$/.test(formData.representativePhone.trim())) {
        errs.representativePhone = 'Số điện thoại không đúng định dạng (ví dụ: 0901234567).'
      }
      if (!formData.businessAddress.trim()) errs.businessAddress = 'Địa chỉ trụ sở chính không được để trống.'
    }
    
    if (step === 2) {
      if (!formData.bankName.trim()) errs.bankName = 'Vui lòng chọn ngân hàng thụ hưởng.'
      if (!formData.branchName.trim()) errs.branchName = 'Tên chi nhánh không được để trống.'
      if (!formData.bankAccountNumber.trim()) {
        errs.bankAccountNumber = 'Số tài khoản không được để trống.'
      } else if (!/^\d{6,20}$/.test(formData.bankAccountNumber.trim())) {
        errs.bankAccountNumber = 'Số tài khoản chỉ bao gồm chữ số (từ 6 đến 20 số).'
      }
      if (!formData.bankAccountName.trim()) {
        errs.bankAccountName = 'Tên chủ tài khoản không được để trống.'
      }
      if (formData.swiftCode.trim() && !/^[A-Z0-9]{8,11}$/i.test(formData.swiftCode.trim())) {
        errs.swiftCode = 'Mã SWIFT/BIC phải gồm từ 8 đến 11 ký tự chữ hoặc số.'
      }
    }
    
    if (step === 3) {
      if (!formData.businessLicenseUrl.trim()) {
        errs.businessLicenseUrl = 'Vui lòng tải lên tài liệu pháp lý hoặc dán URL giấy phép kinh doanh.'
      }
    }
    
    return errs
  }

  const errors = getErrors()
  const isValidStep = Object.keys(errors).length === 0

  const handleInputChange = (e) => {
    const { name, value } = e.target
    
    let processedValue = value
    // Chuyển đổi tên chủ tài khoản ngân hàng và mã SWIFT thành chữ in hoa
    if (name === 'bankAccountName') {
      processedValue = value.toUpperCase()
    } else if (name === 'swiftCode') {
      processedValue = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    }
    
    setFormData((prev) => ({
      ...prev,
      [name]: processedValue,
    }))
  }

  const handleBlur = (field) => {
    setTouched((prev) => ({
      ...prev,
      [field]: true,
    }))
  }

  // Lọc ngân hàng theo ô tìm kiếm
  const filteredBanks = popularBanks.filter((bank) =>
    bank.toLowerCase().includes(bankSearch.toLowerCase())
  )

  const selectBank = (bank) => {
    setFormData((prev) => ({
      ...prev,
      bankName: bank,
    }))
    setBankSearch(bank)
    setShowBankDropdown(false)
    setTouched((prev) => ({ ...prev, bankName: true }))
  }

  const handleNext = () => {
    // Đánh dấu tất cả trường của bước hiện tại là touched
    const fieldsToTouch = {}
    if (step === 1) {
      ['businessName', 'taxCode', 'registrationDate', 'representativeName', 'representativePhone', 'businessAddress'].forEach(
        (f) => (fieldsToTouch[f] = true)
      )
    } else if (step === 2) {
      ['bankName', 'branchName', 'bankAccountNumber', 'bankAccountName'].forEach((f) => (fieldsToTouch[f] = true))
    }
    setTouched((prev) => ({ ...prev, ...fieldsToTouch }))

    if (isValidStep) {
      setStep((prev) => prev + 1)
      window.scrollTo(0, 0)
    } else {
      toast.error('Vui lòng điền đúng và đầy đủ thông tin yêu cầu trước khi tiếp tục.')
    }
  }

  const handleBack = () => {
    setStep((prev) => prev - 1)
    window.scrollTo(0, 0)
  }

  // Xử lý kéo thả và tải tài liệu lên server
  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // Kiểm tra định dạng (chỉ cho phép ảnh hoặc pdf)
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Chỉ hỗ trợ tệp định dạng JPEG, PNG hoặc PDF.')
      return
    }

    // Giới hạn dung lượng dưới 5MB
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Dung lượng tệp tải lên phải nhỏ hơn 5MB.')
      return
    }

    setUploading(true)
    try {
      const documentUrl = await partnerApi.uploadKycDocument(file)
      setFormData((prev) => ({
        ...prev,
        businessLicenseUrl: documentUrl,
      }))
      setUploadedFile(file)
      setTouched((prev) => ({ ...prev, businessLicenseUrl: true }))
      toast.success('Tải lên giấy phép thành công!')
    } catch (error) {
      setUploadedFile(null)
      setFormData((prev) => ({ ...prev, businessLicenseUrl: '' }))
      toast.error(error.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (['PENDING', 'APPROVED', 'SUSPENDED'].includes(partnerProfile?.status)) {
      toast.info('Hồ sơ này đang bị khóa. Vui lòng liên hệ hỗ trợ nếu cần thay đổi thông tin pháp lý.')
      return
    }
    
    // Đánh dấu tất cả là touched
    setTouched({
      businessName: true,
      taxCode: true,
      registrationDate: true,
      representativeName: true,
      representativePhone: true,
      businessAddress: true,
      bankName: true,
      branchName: true,
      bankAccountNumber: true,
      bankAccountName: true,
      swiftCode: true,
      businessLicenseUrl: true,
    })

    if (!isValidStep) {
      toast.error('Vui lòng kiểm tra lại thông tin hồ sơ pháp lý.')
      return
    }
    if (!agreedToTerms) {
      toast.error('Bạn cần xác nhận cam kết và đồng ý điều khoản KYC trước khi nộp hồ sơ.')
      return
    }

    setIsSubmitting(true)
    
    try {
      // Gọi thật tới API theo api contract
      await partnerApi.submitKyc({
        businessName: formData.businessName,
        businessLicenseUrl: formData.businessLicenseUrl,
        taxCode: formData.taxCode,
        registrationDate: formData.registrationDate,
        representativeName: formData.representativeName,
        representativePhone: formData.representativePhone,
        businessAddress: formData.businessAddress,
        bankName: formData.bankName,
        branchName: formData.branchName,
        bankAccountNumber: formData.bankAccountNumber,
        bankAccountName: formData.bankAccountName,
        swiftCode: formData.swiftCode,
        payoutCurrency: formData.payoutCurrency,
        kycConsentAccepted: agreedToTerms,
      })

      toast.success('Nộp hồ sơ xác thực đối tác thành công! Vui lòng chờ admin phê duyệt.')
      await getProfile()
      navigate('/partner/pending')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isProfileLoading) {
    return (
      <main className="min-h-screen bg-[#f8fafb] flex items-center justify-center" aria-live="polite">
        <div className="flex items-center gap-3 text-[#3f484a]">
          <span className="material-symbols-outlined animate-spin" aria-hidden="true">progress_activity</span>
          Đang kiểm tra trạng thái hồ sơ…
        </div>
      </main>
    )
  }

  const lockedStatuses = ['PENDING', 'APPROVED', 'SUSPENDED']
  if (lockedStatuses.includes(partnerProfile?.status)) {
    const statusContent = {
      PENDING: {
        icon: 'hourglass_top',
        title: 'Hồ sơ đang được xét duyệt',
        description: 'Thông tin pháp lý đã được khóa để tránh thay đổi trong quá trình thẩm định.',
      },
      APPROVED: {
        icon: 'verified',
        title: 'Hồ sơ KYC đã được xác minh',
        description: 'Các trường pháp lý và tài chính không thể sửa trực tiếp sau khi phê duyệt.',
      },
      SUSPENDED: {
        icon: 'policy',
        title: 'Hồ sơ đang bị tạm khóa',
        description: 'Chỉ quản trị viên nền tảng có thể xử lý hồ sơ trong thời gian tạm khóa.',
      },
    }[partnerProfile.status]

    return (
      <main className="min-h-screen bg-[#f8fafb]" style={{ fontFamily: "'Be Vietnam Pro', 'Inter', sans-serif" }}>
        <header className="bg-white border-b border-[#e1e3e4] h-16 flex items-center justify-between px-6 md:px-12">
          <Link to="/partner/dashboard" className="flex items-center gap-2 font-bold text-lg text-[#00474d] no-underline">
            <span className="material-symbols-outlined" aria-hidden="true">travel</span>
            VietTicket B2B
          </Link>
          <button
            type="button"
            onClick={async () => { await logout(); navigate('/login', { replace: true }) }}
            className="flex items-center gap-2 text-sm font-medium text-[#ba1a1a]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">logout</span>
            Đăng xuất
          </button>
        </header>
        <div className="mx-auto max-w-3xl px-4 py-12 md:py-20">
          <section className="rounded-2xl border border-[#d7e4e5] bg-white p-6 shadow-sm md:p-10" aria-labelledby="kyc-locked-title">
            <div className="mb-7 flex items-start gap-4">
              <span className="material-symbols-outlined rounded-full bg-[#d9f1f2] p-3 text-3xl text-[#00474d]" aria-hidden="true">
                {statusContent.icon}
              </span>
              <div>
                <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#006068]">Trạng thái hồ sơ</p>
                <h1 id="kyc-locked-title" className="text-2xl font-bold text-[#191c1d]">{statusContent.title}</h1>
                <p className="mt-2 text-sm leading-6 text-[#3f484a]">{statusContent.description}</p>
              </div>
            </div>
            <dl className="grid gap-4 rounded-xl bg-[#f6f8f9] p-5 sm:grid-cols-2">
              <div><dt className="text-xs text-[#6f797a]">Tên doanh nghiệp</dt><dd className="mt-1 font-semibold text-[#191c1d]">{partnerProfile.businessName || 'Chưa cập nhật'}</dd></div>
              <div><dt className="text-xs text-[#6f797a]">Mã số thuế</dt><dd className="mt-1 font-semibold text-[#191c1d]">{partnerProfile.taxCode || 'Chưa cập nhật'}</dd></div>
              <div><dt className="text-xs text-[#6f797a]">Người đại diện</dt><dd className="mt-1 font-semibold text-[#191c1d]">{partnerProfile.representativeName || 'Chưa cập nhật'}</dd></div>
              <div><dt className="text-xs text-[#6f797a]">Ngân hàng nhận đối soát</dt><dd className="mt-1 font-semibold text-[#191c1d]">{partnerProfile.bankName || 'Chưa cập nhật'}</dd></div>
            </dl>
            <div className="mt-7 rounded-xl border border-[#f2d394] bg-[#fff7e6] p-4 text-sm leading-6 text-[#5d4300]">
              Cần điều chỉnh tên pháp lý, mã số thuế, tài khoản ngân hàng hoặc giấy phép? Hãy gửi yêu cầu qua Trung tâm hỗ trợ để nền tảng xác minh và lưu vết thay đổi.
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/partner/dashboard" className="rounded-lg bg-[#006068] px-5 py-2.5 text-sm font-semibold text-white no-underline">Về tổng quan đối tác</Link>
              <Link to="/partner/settings" className="rounded-lg border border-[#9aa5a7] px-5 py-2.5 text-sm font-semibold text-[#00474d] no-underline">Xem cài đặt</Link>
              <a href="mailto:partners@vietticket.com" className="rounded-lg border border-[#9aa5a7] px-5 py-2.5 text-sm font-semibold text-[#00474d] no-underline">Liên hệ hỗ trợ đối tác</a>
            </div>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f8fafb] flex flex-col" style={{ fontFamily: "'Be Vietnam Pro', 'Inter', sans-serif" }}>
      {/* Onboarding Top Navigation Bar */}
      <header className="bg-white border-b border-[#e1e3e4] h-16 flex items-center justify-between px-6 md:px-12 sticky top-0 z-50">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg text-[#00474d]" style={{ textDecoration: 'none' }}>
          <span className="material-symbols-outlined filled" aria-hidden="true">travel</span>
          <span>VietTicket B2B</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/" className="text-sm font-medium text-[#3f484a] hover:text-[#00474d] transition-colors" style={{ textDecoration: 'none' }}>
            Trang chủ khách hàng
          </Link>
          <div className="h-4 w-[1px] bg-[#bec8ca]" />
          <button
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[#ba1a1a] hover:bg-[#ffdad6] hover:text-[#93000a] transition-all duration-200"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
            <span>Đăng xuất</span>
          </button>
        </div>
      </header>

      {/* Main Form Area */}
      <div className="flex-grow flex items-center justify-center py-margin-mobile md:py-margin-desktop px-4">
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-[0px_4px_20px_rgba(0,40,50,0.05)] overflow-hidden flex flex-col border border-[#eceeef]">
        
        <div className="bg-white rounded-xl p-6 md:p-10">
          {/* Stepper */}
          <div className="mb-10">
            <div className="flex items-center justify-between relative">
              {/* Progress Line Background */}
              <div className="absolute top-1/2 left-0 w-full h-[2px] bg-[#e1e3e4] -z-10 -translate-y-1/2"></div>
              {/* Progress Line Active */}
              <div 
                className="absolute top-1/2 left-0 h-[2px] bg-[#00474d] -z-10 -translate-y-1/2 transition-all duration-300"
                style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}
              ></div>

              {/* Step 1: Completed / Active */}
              <div className="flex flex-col items-center gap-2 bg-white px-2 z-10">
                {step > 1 ? (
                  <div className="w-8 h-8 rounded-full bg-[#10b981] flex items-center justify-center text-white">
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#00474d] text-white flex items-center justify-center border-2 border-white shadow-sm font-semibold">
                    1
                  </div>
                )}
                <span className={`font-semibold text-xs md:text-sm hidden sm:block ${
                  step > 1 ? 'text-[#10b981]' : step === 1 ? 'text-[#00474d]' : 'text-[#6f797a]'
                }`}>
                  Thông tin doanh nghiệp
                </span>
              </div>

              {/* Step 2: Completed / Active */}
              <div className="flex flex-col items-center gap-2 bg-white px-2 z-10">
                {step > 2 ? (
                  <div className="w-8 h-8 rounded-full bg-[#10b981] flex items-center justify-center text-white">
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  </div>
                ) : (
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 border-white shadow-sm font-semibold ${
                    step === 2 ? 'bg-[#006068] text-white' : 'bg-[#e6e8e9] text-[#3f484a]'
                  }`}>
                    2
                  </div>
                )}
                <span className={`font-semibold text-xs md:text-sm hidden sm:block ${
                  step > 2 ? 'text-[#10b981]' : step === 2 ? 'text-[#00474d]' : 'text-[#6f797a]'
                }`}>
                  Thông tin tài chính
                </span>
              </div>

              {/* Step 3: Active / Inactive */}
              <div className="flex flex-col items-center gap-2 bg-white px-2 z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 border-white shadow-sm font-semibold ${
                  step === 3 ? 'bg-[#00474d] text-white' : 'bg-[#e6e8e9] text-[#3f484a]'
                }`}>
                  3
                </div>
                <span className={`font-semibold text-xs md:text-sm hidden sm:block ${
                  step === 3 ? 'text-[#00474d]' : 'text-[#6f797a]'
                }`}>
                  Hồ sơ pháp lý
                </span>
              </div>
            </div>
          </div>

          {/* Step 1: Thông tin doanh nghiệp */}
          {step === 1 && (
            <div className="animate-fadeIn">
              {/* Header Section */}
              <div className="mb-8 text-center md:text-left">
                <h1 className="text-2xl md:text-3xl font-bold text-[#191c1d] mb-2">Thông tin doanh nghiệp</h1>
                <p className="text-[#3f484a] text-sm md:text-base">
                  Vui lòng cung cấp các thông tin đăng ký chính thức của doanh nghiệp hoặc địa điểm tham quan.
                </p>
              </div>

              <form className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6" onSubmit={(e) => e.preventDefault()}>
                {/* Tên doanh nghiệp */}
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Tên doanh nghiệp / Địa điểm tham quan <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.businessName && errors.businessName 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">store</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none"
                      placeholder="VD: Công ty TNHH Du lịch & Vé Việt Nam"
                      type="text"
                      name="businessName"
                      value={formData.businessName}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('businessName')}
                    />
                  </div>
                  {touched.businessName && errors.businessName && (
                    <p className="mt-1 text-xs text-red-500">{errors.businessName}</p>
                  )}
                </div>

                {/* Mã số thuế */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Mã số thuế (TIN) <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.taxCode && errors.taxCode 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">description</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none"
                      placeholder="VD: 0123456789"
                      type="text"
                      inputMode="numeric"
                      maxLength={13}
                      name="taxCode"
                      value={formData.taxCode}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('taxCode')}
                    />
                  </div>
                  {touched.taxCode && errors.taxCode && (
                    <p className="mt-1 text-xs text-red-500">{errors.taxCode}</p>
                  )}
                </div>

                {/* Ngày đăng ký */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Ngày đăng ký kinh doanh <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.registrationDate && errors.registrationDate 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">calendar_today</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none cursor-pointer"
                      type="date"
                      name="registrationDate"
                      value={formData.registrationDate}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('registrationDate')}
                    />
                  </div>
                  {touched.registrationDate && errors.registrationDate && (
                    <p className="mt-1 text-xs text-red-500">{errors.registrationDate}</p>
                  )}
                </div>

                {/* Người đại diện */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Tên người đại diện pháp luật <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.representativeName && errors.representativeName 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">person</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none"
                      placeholder="Họ và tên người đại diện"
                      type="text"
                      name="representativeName"
                      value={formData.representativeName}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('representativeName')}
                    />
                  </div>
                  {touched.representativeName && errors.representativeName && (
                    <p className="mt-1 text-xs text-red-500">{errors.representativeName}</p>
                  )}
                </div>

                {/* Số điện thoại */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Số điện thoại liên hệ <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.representativePhone && errors.representativePhone 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">phone</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none"
                      placeholder="VD: 090xxxxxxxx"
                      type="tel"
                      name="representativePhone"
                      value={formData.representativePhone}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('representativePhone')}
                    />
                  </div>
                  {touched.representativePhone && errors.representativePhone && (
                    <p className="mt-1 text-xs text-red-500">{errors.representativePhone}</p>
                  )}
                </div>

                {/* Địa chỉ */}
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Địa chỉ trụ sở chính <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.businessAddress && errors.businessAddress 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2 self-start mt-3">location_on</span>
                    <textarea
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none resize-none"
                      placeholder="Nhập địa chỉ đầy đủ"
                      rows="3"
                      name="businessAddress"
                      value={formData.businessAddress}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('businessAddress')}
                    />
                  </div>
                  {touched.businessAddress && errors.businessAddress && (
                    <p className="mt-1 text-xs text-red-500">{errors.businessAddress}</p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="col-span-1 md:col-span-2 mt-8 pt-6 border-t border-[#e1e3e4] flex justify-end">
                  <button
                    onClick={handleNext}
                    className="w-full md:w-auto px-8 py-3 rounded-lg bg-gradient-to-r from-[#00474d] to-[#8ad2db] text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-sm flex items-center justify-center gap-2"
                    type="button"
                  >
                    Lưu & Tiếp theo
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Step 2: Thông tin tài chính */}
          {step === 2 && (
            <div className="animate-fadeIn">
              {/* Header Section */}
              <div className="mb-8 text-center md:text-left">
                <h1 className="text-2xl md:text-3xl font-bold text-[#191c1d] mb-2">Thông tin tài khoản ngân hàng</h1>
                <p className="text-[#3f484a] text-sm md:text-base">
                  Chúng tôi nên gửi doanh thu bán vé cho bạn qua đâu? Dữ liệu của bạn được mã hóa và bảo mật.
                </p>
              </div>

              {/* Security Alert Banner */}
              <div className="bg-[#cfe5ff] text-[#004a77] p-4 rounded-lg flex items-start gap-3 mb-8 border border-[#98cbff]">
                <span className="material-symbols-outlined mt-0.5 text-[#00629d] filled" aria-hidden="true">
                  lock
                </span>
                <div>
                  <p className="text-sm font-medium">Chúng tôi sử dụng tiêu chuẩn mã hóa AES-256 để bảo vệ thông tin tài chính của bạn.</p>
                </div>
              </div>

              <form className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6" onSubmit={(e) => e.preventDefault()}>
                {/* Bank Name (Searchable Selector) */}
                <div className="col-span-1 md:col-span-2" ref={bankDropdownRef}>
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Tên ngân hàng <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-visible flex items-center px-3 transition-colors duration-200 ${
                    touched.bankName && errors.bankName 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">account_balance</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none cursor-pointer"
                      placeholder="Tìm kiếm ngân hàng của bạn..."
                      type="text"
                      value={bankSearch}
                      onChange={(e) => {
                        setBankSearch(e.target.value)
                        setFormData(prev => ({ ...prev, bankName: e.target.value }))
                        setShowBankDropdown(true)
                      }}
                      onFocus={() => {
                        setShowBankDropdown(true)
                        if (formData.bankName) {
                          setBankSearch(formData.bankName)
                        }
                      }}
                      onBlur={() => handleBlur('bankName')}
                    />
                    <span 
                      className="material-symbols-outlined text-[#6f797a] ml-2 cursor-pointer text-xl"
                      onClick={() => setShowBankDropdown(!showBankDropdown)}
                    >
                      arrow_drop_down
                    </span>

                    {/* Bank Selection Dropdown List */}
                    {showBankDropdown && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#bec8ca] rounded-lg shadow-lg max-h-60 overflow-y-auto z-50">
                        {filteredBanks.length > 0 ? (
                          filteredBanks.map((bank) => (
                            <div
                              key={bank}
                              className="px-4 py-3 hover:bg-[#f2f4f5] cursor-pointer text-sm text-[#191c1d] transition-colors"
                              onClick={() => selectBank(bank)}
                            >
                              {bank}
                            </div>
                          ))
                        ) : (
                          <div 
                            className="px-4 py-3 cursor-pointer text-sm text-[#6f797a] italic"
                            onClick={() => {
                              selectBank(bankSearch)
                            }}
                          >
                            Sử dụng ngân hàng: "{bankSearch}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {touched.bankName && errors.bankName && (
                    <p className="mt-1 text-xs text-red-500">{errors.bankName}</p>
                  )}
                </div>

                {/* Branch Name */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Tên chi nhánh <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.branchName && errors.branchName 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">location_on</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none"
                      placeholder="VD: Chi nhánh Hoàn Kiếm"
                      type="text"
                      name="branchName"
                      value={formData.branchName}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('branchName')}
                    />
                  </div>
                  {touched.branchName && errors.branchName && (
                    <p className="mt-1 text-xs text-red-500">{errors.branchName}</p>
                  )}
                </div>

                {/* Account Holder Name */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Tên chủ tài khoản <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.bankAccountName && errors.bankAccountName 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">person</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm uppercase outline-none"
                      placeholder="Tên chính xác trên tài khoản"
                      type="text"
                      name="bankAccountName"
                      value={formData.bankAccountName}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('bankAccountName')}
                    />
                  </div>
                  {touched.bankAccountName && errors.bankAccountName && (
                    <p className="mt-1 text-xs text-red-500">{errors.bankAccountName}</p>
                  )}
                </div>

                {/* Account Number */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Số tài khoản <span className="text-red-500">*</span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.bankAccountNumber && errors.bankAccountNumber 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">tag</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm outline-none"
                      placeholder="Nhập số tài khoản"
                      type="text"
                      name="bankAccountNumber"
                      value={formData.bankAccountNumber}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('bankAccountNumber')}
                    />
                  </div>
                  {touched.bankAccountNumber && errors.bankAccountNumber && (
                    <p className="mt-1 text-xs text-red-500">{errors.bankAccountNumber}</p>
                  )}
                </div>

                {/* SWIFT / BIC Code */}
                <div className="col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2 flex justify-between items-center">
                    <span>Mã SWIFT / BIC</span>
                    <span 
                      className="material-symbols-outlined text-[#6f797a] text-[16px] cursor-help" 
                      title="Mã gồm 8-11 ký tự để xác định ngân hàng của bạn trên trường quốc tế."
                    >
                      info
                    </span>
                  </label>
                  <div className={`relative rounded-lg border bg-white overflow-hidden flex items-center px-3 transition-colors duration-200 ${
                    touched.swiftCode && errors.swiftCode 
                      ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20' 
                      : 'border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30'
                  }`}>
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">public</span>
                    <input
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] placeholder-[#bec8ca] text-sm uppercase outline-none"
                      placeholder="VD: VCBKVNVX"
                      type="text"
                      name="swiftCode"
                      value={formData.swiftCode}
                      onChange={handleInputChange}
                      onBlur={() => handleBlur('swiftCode')}
                    />
                  </div>
                  {touched.swiftCode && errors.swiftCode && (
                    <p className="mt-1 text-xs text-red-500">{errors.swiftCode}</p>
                  )}
                </div>

                {/* Payout Currency Preference */}
                <div className="col-span-1 md:col-span-2 lg:col-span-1">
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Loại tiền tệ thanh toán
                  </label>
                  <div className="relative rounded-lg border border-[#bec8ca] focus-within:border-[#00474d] focus-within:ring-2 focus-within:ring-[#8ad2db]/30 bg-white overflow-hidden flex items-center px-3 transition-colors duration-200">
                    <span className="material-symbols-outlined text-[#6f797a] mr-2">payments</span>
                    <select 
                      className="w-full py-3 bg-transparent border-none focus:ring-0 text-[#191c1d] text-sm outline-none appearance-none cursor-pointer pr-10"
                      name="payoutCurrency"
                      value={formData.payoutCurrency}
                      onChange={handleInputChange}
                    >
                      <option value="VND">Việt Nam Đồng (VND)</option>
                      <option value="USD">US Dollar (USD)</option>
                      <option value="EUR">Euro (EUR)</option>
                    </select>
                    <span className="material-symbols-outlined text-[#6f797a] ml-2 pointer-events-none absolute right-3 text-xl">
                      arrow_drop_down
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="col-span-1 md:col-span-2 mt-8 pt-6 border-t border-[#e1e3e4] flex flex-col-reverse md:flex-row justify-between items-center gap-4">
                  <button
                    onClick={handleBack}
                    className="w-full md:w-auto px-6 py-3 rounded-lg border border-[#bec8ca] text-[#3f484a] font-semibold text-sm hover:bg-[#f2f4f5] hover:text-[#00474d] transition-colors duration-200 flex items-center justify-center gap-2"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    Quay lại
                  </button>
                  <button
                    onClick={handleNext}
                    className="w-full md:w-auto px-8 py-3 rounded-lg bg-gradient-to-r from-[#00474d] to-[#8ad2db] text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-sm flex items-center justify-center gap-2"
                    type="button"
                  >
                    Lưu & Tiếp theo
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Step 3: Hồ sơ pháp lý */}
          {step === 3 && (
            <div className="animate-fadeIn">
              {/* Header */}
              <header className="mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-[#191c1d] mb-2">Tải lên hồ sơ pháp lý</h1>
                <p className="text-[#3f484a] text-sm md:text-base">
                  Vui lòng tải lên các tài liệu cần thiết để xác minh doanh nghiệp của bạn. Định dạng chấp nhận: PDF, JPG, PNG (Tối đa 5MB).
                </p>
              </header>

              <section className="space-y-6">
                {/* Upload 1: Giấy phép đăng ký kinh doanh */}
                <div>
                  <label className="block text-sm font-semibold text-[#191c1d] mb-2">
                    Giấy phép đăng ký kinh doanh <span className="text-red-500">*</span>
                  </label>

                  {uploadedFile ? (
                    /* File đã tải lên — hiển thị dạng card */
                    <div className="border border-[#bec8ca] rounded-xl p-4 flex items-center justify-between bg-white hover:shadow-sm transition-shadow">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-[#f2f4f5] flex items-center justify-center text-[#6f797a]">
                          <span className="material-symbols-outlined">description</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-[#191c1d]">{uploadedFile.name}</span>
                          <span className="text-xs text-[#6f797a]">
                            {Number.isFinite(uploadedFile.size)
                              ? `${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB`
                              : 'Tài liệu đã lưu an toàn'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="hidden sm:flex items-center gap-1 bg-[#136870]/10 text-[#136870] px-2 py-1 rounded-full">
                          <span className="material-symbols-outlined text-[16px]">check_circle</span>
                          <span className="text-xs font-semibold">Thành công</span>
                        </div>
                        <button
                          aria-label="Xóa tệp"
                          onClick={() => { setUploadedFile(null); setFormData(prev => ({ ...prev, businessLicenseUrl: '' })) }}
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[#6f797a] hover:text-[#ba1a1a] hover:bg-[#ffdad6] transition-colors"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Drop zone */
                    <div className="border-2 border-dashed border-[#bec8ca] hover:border-[#006068] rounded-xl p-8 flex flex-col items-center justify-center bg-[#f8fafb] transition-colors duration-200 cursor-pointer relative group">
                      <input
                        type="file"
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        onChange={handleFileChange}
                        accept=".jpg,.jpeg,.png,.pdf"
                      />
                      <div className="w-12 h-12 rounded-full bg-[#f2f4f5] group-hover:bg-[#006068]/10 flex items-center justify-center mb-3 transition-colors">
                        <span className="material-symbols-outlined text-[#006068] text-3xl">cloud_upload</span>
                      </div>
                      {uploading ? (
                        <div className="flex flex-col items-center">
                          <div className="w-24 h-1.5 bg-[#e1e3e4] rounded-full overflow-hidden mb-2">
                            <div className="h-full bg-[#00474d] animate-pulse w-full"></div>
                          </div>
                          <p className="text-xs text-[#3f484a] font-medium">Đang xử lý tải lên...</p>
                        </div>
                      ) : (
                        <span className="text-sm text-[#6f797a] group-hover:text-[#006068] transition-colors">
                          Nhấp để tải lên hoặc kéo thả
                        </span>
                      )}
                    </div>
                  )}

                  {touched.businessLicenseUrl && errors.businessLicenseUrl && (
                    <p className="mt-1 text-xs text-red-500">{errors.businessLicenseUrl}</p>
                  )}
                </div>

              </section>

              {/* Terms Checkbox */}
              <div className="mt-8 pt-6 border-t border-[#e1e3e4]">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="flex items-center h-5 mt-0.5 flex-shrink-0">
                    <input
                      className="w-5 h-5 accent-[#00474d] cursor-pointer"
                      type="checkbox"
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                    />
                  </div>
                  <span className="text-sm text-[#3f484a] leading-tight select-none">
                    Tôi cam đoan mọi thông tin và tài liệu cung cấp là chính xác. Tôi đồng ý với{' '}
                    <Link className="text-[#006068] hover:underline font-semibold" to="/terms">Điều khoản dịch vụ</Link>
                    {' '}và{' '}
                    <Link className="text-[#006068] hover:underline font-semibold" to="/privacy">Chính sách bảo mật</Link>.
                  </span>
                </label>
              </div>

              {/* Action Buttons */}
              <footer className="mt-10 flex flex-col-reverse sm:flex-row justify-between items-center gap-4">
                <button
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-6 py-3 rounded-full border border-[#6f797a] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors duration-200 disabled:opacity-50"
                  type="button"
                >
                  Quay lại
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !isValidStep || !agreedToTerms}
                  className={`w-full sm:w-auto px-6 py-3 rounded-full text-sm font-medium flex items-center justify-center gap-2 transition-all duration-300 ${
                    isValidStep && agreedToTerms && !isSubmitting
                      ? 'bg-[#00474d] text-white hover:bg-[#006068] shadow-sm cursor-pointer'
                      : 'bg-[#e1e3e4] text-[#6f797a] cursor-not-allowed'
                  }`}
                  type="button"
                >
                  {isSubmitting ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Đang nộp hồ sơ...
                    </>
                  ) : (
                    <>
                      <span>Gửi hồ sơ</span>
                      <span className="material-symbols-outlined text-[20px]">send</span>
                    </>
                  )}
                </button>
              </footer>
            </div>
          )}
        </div>
        
        {/* Thêm CSS Keyframes cho hiệu ứng mượt mà */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fadeIn {
            animation: fadeIn 0.4s ease-out forwards;
          }
        `}</style>
      </div>
      </div>
    </main>
  )
}

export default PartnerKycPage
