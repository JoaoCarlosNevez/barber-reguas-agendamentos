// O app instalável (PWA) é só o da equipe, em /app. No resto do site
// (agendamento, área do cliente, painel super admin) tiramos o <link rel="manifest">
// e a meta do iOS, para o navegador não oferecer "instalar" e o atalho da tela
// inicial abrir no navegador comum.

export const PWA_SCOPE = '/app'

export const inPwaScope = (pathname: string) => pathname === PWA_SCOPE || pathname.startsWith(`${PWA_SCOPE}/`)

let manifestHref: string | null = null

function setMeta(name: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (content === null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('meta')
    el.name = name
    document.head.append(el)
  }
  el.content = content
}

export function syncPwaScope(pathname: string) {
  const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (link && manifestHref === null) manifestHref = link.getAttribute('href')
  const href = manifestHref ?? '/manifest.webmanifest'

  if (inPwaScope(pathname)) {
    if (!link) {
      const el = document.createElement('link')
      el.rel = 'manifest'
      el.href = href
      document.head.append(el)
    }
    setMeta('apple-mobile-web-app-capable', 'yes')
    setMeta('mobile-web-app-capable', 'yes')
    setMeta('apple-mobile-web-app-title', 'Barbearia')
  } else {
    link?.remove()
    setMeta('apple-mobile-web-app-capable', null)
    setMeta('mobile-web-app-capable', null)
    setMeta('apple-mobile-web-app-title', null)
  }
}
