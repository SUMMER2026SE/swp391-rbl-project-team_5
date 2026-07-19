import BookingSteps from '../components/BookingSteps.jsx'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import HeroSection from '../components/HeroSection.jsx'
import HeroSlider from '../components/HeroSlider.jsx'
import Newsletter from '../components/Newsletter.jsx'
import PartnerCTASection from '../components/PartnerCTASection.jsx'
import PopularDestinations from '../components/PopularDestinations.jsx'
import RecentlyViewedAttractions from '../components/RecentlyViewedAttractions.jsx'
import ServiceCategories from '../components/ServiceCategories.jsx'
import Testimonials from '../components/Testimonials.jsx'
import TravelIntentSection from '../components/TravelIntentSection.jsx'
import AIRecommendSection from '../components/AIRecommendSection.jsx'
import Seo from '../components/Seo.jsx'
import {
  bookingPreview,
  bookingSteps,
  footerLinks,
  heroContent,
  navLinks,
  serviceCategories,
  sliderSlides,
} from '../data/landingData.js'

function HomePage() {
  return (
    <>
      <Seo
        title="VietTicket Travel | Đặt vé tham quan Việt Nam"
        description="Tìm kiếm, đặt và quản lý vé tham quan Việt Nam với thanh toán trực tuyến và vé QR."
      />
      <Header links={navLinks} />
      <HeroSlider slides={sliderSlides} />
      <main>
        <HeroSection content={heroContent} />
        <TravelIntentSection />
        <RecentlyViewedAttractions />
        <ServiceCategories categories={serviceCategories} />
        <PopularDestinations />
        <AIRecommendSection />
        <BookingSteps steps={bookingSteps} preview={bookingPreview} />
        <Testimonials />
        <PartnerCTASection />
        <Newsletter />
      </main>
      <Footer links={footerLinks} />
    </>
  )
}

export default HomePage
