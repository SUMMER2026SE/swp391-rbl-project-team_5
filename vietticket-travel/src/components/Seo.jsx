import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { getRouteRobots } from '../utils/routeMetadata.js'

function upsertMeta(selector, attributes) {
  let element = document.head.querySelector(selector)
  if (!element) {
    element = document.createElement('meta')
    document.head.appendChild(element)
  }
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value))
}

function Seo({ title, description, noIndex = false }) {
  const { pathname } = useLocation()

  useEffect(() => {
    const fullTitle = title.includes('VietTicket') ? title : `${title} | VietTicket Travel`
    document.title = fullTitle
    upsertMeta('meta[name="description"]', { name: 'description', content: description })
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: fullTitle })
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description,
    })
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' })
    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: noIndex ? 'noindex,nofollow' : getRouteRobots(pathname),
    })
  }, [description, noIndex, pathname, title])

  return null
}

export default Seo
