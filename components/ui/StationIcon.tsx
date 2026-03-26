import { RadioTower, Antenna, Router, Satellite, LucideProps } from 'lucide-react'
import { StationType } from '@/lib/rf'

const ICONS: Record<StationType, React.FC<LucideProps>> = {
  bts:      RadioTower,
  antenna:  Antenna,
  router:   Router,
  repeater: Satellite,
}

interface StationIconProps extends LucideProps {
  type: StationType
}

export default function StationIcon({ type, ...props }: StationIconProps) {
  const Icon = ICONS[type]
  return <Icon {...props} />
}
