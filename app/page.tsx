'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import TopBar from '@/components/TopBar'
import Toolbar from '@/components/Toolbar/Toolbar'
import Sidebar from '@/components/Sidebar/Sidebar'
import InfoModal from '@/components/InfoModal/InfoModal'
import CalcDebugModal from '@/components/CalcDebug/CalcDebugModal'

const MapView = dynamic(() => import('@/components/Map/MapView'), { ssr: false })

export default function Home() {
  const [showInfo, setShowInfo] = useState(false)
  const [showCalcDebug, setShowCalcDebug] = useState(false)

  return (
    <>
      <div style={{
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '46px 1fr',
        gridTemplateColumns: '54px 1fr 300px',
        gridTemplateAreas: '"topbar topbar topbar" "toolbar map panel"',
      }}>
        <TopBar onInfoOpen={() => setShowInfo(true)} onCalcDebugOpen={() => setShowCalcDebug(true)} />
        <Toolbar />
        <MapView />
        <Sidebar />
      </div>
      <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} />
      <CalcDebugModal isOpen={showCalcDebug} onClose={() => setShowCalcDebug(false)} />
    </>
  )
}
