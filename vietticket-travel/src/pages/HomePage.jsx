import BookingSteps from '../components/BookingSteps.jsx'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import HeroSection from '../components/HeroSection.jsx'
import HeroSlider from '../components/HeroSlider.jsx'
import Newsletter from '../components/Newsletter.jsx'
import PartnerCTASection from '../components/PartnerCTASection.jsx'
import PopularDestinations from '../components/PopularDestinations.jsx'
import ServiceCategories from '../components/ServiceCategories.jsx'
import Testimonials from '../components/Testimonials.jsx'
import {
  appDownloadButtons,
  bookingPreview,
  bookingSteps,
  footerLinks,
  heroContent,
  navLinks,
  partners,
  popularDestinations,
  serviceCategories,
  sliderSlides,
  testimonials,
} from '../data/landingData.js'

function HomePage() {
  return (
    <>
      <Header links={navLinks} />
      <HeroSlider slides={sliderSlides} />
      <main>
        <HeroSection content={heroContent} />
        <ServiceCategories categories={serviceCategories} />
        <PopularDestinations destinations={popularDestinations} />
        <BookingSteps steps={bookingSteps} preview={bookingPreview} />
        <Testimonials testimonials={testimonials} partners={partners} />
        <PartnerCTASection />
        <Newsletter />
      </main>
      <Footer links={footerLinks} appButtons={appDownloadButtons} />
    </>
  )
}

export default HomePage
