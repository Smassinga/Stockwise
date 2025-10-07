import React from 'react'

export function SwHeader(){
  return (
    <header className="header">
      <svg className="logo" viewBox="0 0 256 256" aria-label="StockWise">
        <path d="M44 92 C44 62 84 46 114 54 C140 60 154 78 148 98 C142 116 122 126 106 134 C86 144 74 156 74 176 C74 198 98 206 118 202 C134 200 148 192 158 182" fill="none" stroke="var(--sw-ink)" strokeWidth="16" strokeLinecap="round"/>
        <path d="M100 170 L126 188 L198 122" fill="none" stroke="var(--sw-blue)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M166 154 L214 154" fill="none" stroke="var(--sw-blue)" strokeWidth="16" strokeLinecap="round"/>
      </svg>
      <div className="brand"><span>Stock</span><span className="wise">Wise</span></div>
    </header>
  )
}
