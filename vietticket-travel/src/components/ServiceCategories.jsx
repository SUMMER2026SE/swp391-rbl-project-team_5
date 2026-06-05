import { Link } from 'react-router-dom'

function ServiceCategories({ categories }) {
  return (
    <section className="section container text-center" id="services">
      <p className="eyebrow">Danh mục</p>
      <h2>Chúng tôi cung cấp dịch vụ vé du lịch tốt nhất</h2>

      <div className="service-grid">
        {categories.map((category) => (
          <Link
            to="/attractions"
            className={`service-card block transition hover:-translate-y-1 hover:shadow-lg focus:outline-none${
              category.featured ? ' service-card--featured' : ''
            }`}
            key={category.title}
          >
            <div className="service-card__icon">
              <span className="material-symbols-outlined" aria-hidden="true">
                {category.icon}
              </span>
            </div>
            <h3>{category.title}</h3>
            <p>{category.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default ServiceCategories
