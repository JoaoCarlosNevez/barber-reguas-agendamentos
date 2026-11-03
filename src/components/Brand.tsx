/** Marca Studio Réguas: brasão + "Studio Réguas" (versões brancas da logo em /public/brand). */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <img src="/brand/shield-white.png" alt="" width={382} height={531} className="h-9 w-auto" />
      <img src="/brand/wordmark-white.png" alt="Studio Réguas" width={600} height={225} className="h-8 w-auto" />
    </span>
  )
}

export function BrandLogo({ className = '' }: { className?: string }) {
  return <img src="/brand/logo-white.png" alt="Studio Réguas" width={900} height={747} className={className} />
}
