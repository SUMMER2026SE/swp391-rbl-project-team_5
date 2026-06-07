import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'

function HeroSlider({ slides }) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const slideIntervalRef = useRef(null)

  const stopAutoPlay = useCallback(() => {
    if (slideIntervalRef.current) {
      clearInterval(slideIntervalRef.current)
    }
  }, [])

  const startAutoPlay = useCallback(() => {
    stopAutoPlay()
    slideIntervalRef.current = setInterval(() => {
      setCurrentSlideIndex((prevIndex) => (prevIndex + 1) % slides.length)
    }, 5000)
  }, [slides.length, stopAutoPlay])

  useEffect(() => {
    startAutoPlay()
    return () => stopAutoPlay()
  }, [startAutoPlay, stopAutoPlay])

  const handleNext = () => {
    setCurrentSlideIndex((prevIndex) => (prevIndex + 1) % slides.length)
    startAutoPlay()
  }

  const handlePrev = () => {
    setCurrentSlideIndex((prevIndex) => (prevIndex - 1 + slides.length) % slides.length)
    startAutoPlay()
  }

  const handleDotClick = (index) => {
    setCurrentSlideIndex(index)
    startAutoPlay()
  }

  return (
    <section className="hero-slider group" aria-label="Hero slider Banners">
      <div
        className="slider-track"
        style={{ transform: `translateX(-${currentSlideIndex * 100}%)` }}
      >
        {slides.map((slide, index) => (
          <div className="slide" key={index} aria-hidden={index !== currentSlideIndex}>
            <div className="slide__image-container">
              <img src={slide.image.src} alt={slide.image.alt} className="slide__image" />
              <div className="slide__overlay" />
            </div>
            <div className="slide__content container">
              <div className="slide__copy">
                <h1 className="slide__title">{slide.title}</h1>
                <p className="slide__desc">{slide.description}</p>
                <div className="slide__actions">
                  <Link to="/attractions" className="button button--primary button--large">
                    {slide.primaryCta}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        className="slider-arrow slider-arrow--prev"
        onClick={handlePrev}
        aria-label="Slide trước"
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          chevron_left
        </span>
      </button>
      <button
        className="slider-arrow slider-arrow--next"
        onClick={handleNext}
        aria-label="Slide tiếp theo"
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          chevron_right
        </span>
      </button>

      <div className="slider-dots">
        {slides.map((_, index) => (
          <button
            key={index}
            className={`slider-dot${index === currentSlideIndex ? ' slider-dot--active' : ''}`}
            onClick={() => handleDotClick(index)}
            aria-label={`Đi tới slide ${index + 1}`}
            aria-current={index === currentSlideIndex ? 'true' : 'false'}
          />
        ))}
      </div>
    </section>
  )
}

export default HeroSlider
